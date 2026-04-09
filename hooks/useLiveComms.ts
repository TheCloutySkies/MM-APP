import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import {
    adminInviteMemberToGlobal,
    initGlobalGroupForAdmin,
    isGroupAdmin,
    loadGlobalGroupKeyForMember,
} from "@/lib/e2ee/groupKeys";
import {
    bootstrapIdentityOnDevice,
    hasLocalIdentity,
    unlockIdentityPrivateKey,
} from "@/lib/e2ee/identity";
import { appendOutbox, loadOutbox, replaceOutbox } from "@/lib/e2ee/localStore";
import type { E2eeBroadcastV1, E2eeChatMessage, E2eeEnvelopeRow } from "@/lib/e2ee/types";
import { GLOBAL_GROUP_ID } from "@/lib/e2ee/types";
import {
    buildBroadcast,
    decryptDmPayload,
    decryptGroupPayload,
    dmRealtimeTopic,
    encryptDmPayload,
    encryptGroupPayload,
    GROUP_REALTIME_TOPIC,
} from "@/lib/e2ee/wire";
import { useMMStore } from "@/store/mmStore";

function newMsgId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function flushOutboxQueue(
  supabase: NonNullable<ReturnType<typeof useMMStore.getState>["supabase"]>,
  profileId: string,
): Promise<void> {
  const q = await loadOutbox();
  if (!q.length) return;
  const rows = q.map((x) => ({
    sender_id: profileId,
    recipient_id: x.payload.recipient_id,
    group_id: x.payload.group_id,
    iv: x.payload.iv,
    ciphertext: x.payload.ciphertext,
    client_msg_id: x.payload.client_msg_id,
  }));
  const { error } = await supabase.from("e2ee_comms_envelopes").insert(rows);
  if (!error) await replaceOutbox([]);
}

export type CommsMode = "grp" | "dm";

export function useLiveComms() {
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);
  const username = useMMStore((s) => s.username);
  const vaultMode = useMMStore((s) => s.vaultMode);

  const webOk = Platform.OS === "web";

  const [commsMode, setCommsMode] = useState<CommsMode>("grp");
  const [peerInput, setPeerInput] = useState("");
  const [activePeerId, setActivePeerId] = useState<string | null>(null);
  const [messages, setMessages] = useState<E2eeChatMessage[]>([]);
  const [panelPin, setPanelPin] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [hasIdentityDevice, setHasIdentityDevice] = useState(false);
  const [invitePeerId, setInvitePeerId] = useState("");
  /** Global channel only: recent distinct sender_ids (ciphertext envelope metadata — no message content). */
  const [channelRoster, setChannelRoster] = useState<string[]>([]);

  const privateKeyRef = useRef<CryptoKey | null>(null);
  const groupKeyRef = useRef<Uint8Array | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const mySpkiRef = useRef<string | null>(null);

  useEffect(() => {
    if (!profileId || !webOk) return;
    void (async () => {
      setHasIdentityDevice(await hasLocalIdentity(profileId));
    })();
  }, [profileId, webOk]);

  useEffect(() => {
    if (vaultMode == null) {
      privateKeyRef.current = null;
      groupKeyRef.current = null;
      setUnlocked(false);
    }
  }, [vaultMode]);

  const refreshMySpki = useCallback(async () => {
    if (!supabase || !profileId) return;
    const { data } = await supabase
      .from("e2ee_identity_keys")
      .select("public_key_spki")
      .eq("profile_id", profileId)
      .maybeSingle();
    mySpkiRef.current = (data?.public_key_spki as string | undefined) ?? null;
  }, [supabase, profileId]);

  const syncGroupKey = useCallback(async () => {
    if (!supabase || !profileId || !privateKeyRef.current) return;
    const { groupKey, error } = await loadGlobalGroupKeyForMember(supabase, profileId, privateKeyRef.current);
    if (error) {
      setStatus(error.message);
      groupKeyRef.current = null;
      return;
    }
    groupKeyRef.current = groupKey;
    setStatus(null);
  }, [supabase, profileId]);

  const ingestPayload = useCallback(
    async (payload: E2eeBroadcastV1) => {
      if (!supabase || !profileId || !privateKeyRef.current) return;
      if (seenRef.current.has(payload.clientMsgId)) return;
      seenRef.current.add(payload.clientMsgId);

      if (payload.kind === "dm") {
        if (commsMode !== "dm" || !activePeerId) return;
        const pair = [profileId, activePeerId].sort();
        if (!pair.includes(payload.from)) return;
        const { text, error } = await decryptDmPayload(
          supabase,
          privateKeyRef.current,
          payload.from,
          payload.ivB64,
          payload.ctB64,
        );
        if (error || !text) return;
        const m: E2eeChatMessage = {
          id: payload.clientMsgId,
          clientMsgId: payload.clientMsgId,
          fromId: payload.from,
          plaintext: text,
          ts: payload.ts,
          mine: payload.from === profileId,
        };
        setMessages((prev) => [...prev, m]);
        return;
      }

      if (payload.kind === "grp" && commsMode === "grp") {
        const gk = groupKeyRef.current;
        if (!gk) return;
        try {
          const text = await decryptGroupPayload(gk, payload.ivB64, payload.ctB64);
          const m: E2eeChatMessage = {
            id: payload.clientMsgId,
            clientMsgId: payload.clientMsgId,
            fromId: payload.from,
            plaintext: text,
            ts: payload.ts,
            mine: payload.from === profileId,
          };
          setMessages((prev) => [...prev, m]);
        } catch {
          /* bad epoch key */
        }
      }
    },
    [supabase, profileId, commsMode, activePeerId],
  );

  const applyEnvelopeRow = useCallback(
    async (row: E2eeEnvelopeRow) => {
      if (!supabase || !profileId || !privateKeyRef.current) return;
      if (row.client_msg_id && seenRef.current.has(row.client_msg_id)) return;
      if (row.client_msg_id) seenRef.current.add(row.client_msg_id);

      if (row.group_id === GLOBAL_GROUP_ID && commsMode === "grp") {
        const gk = groupKeyRef.current;
        if (!gk) return;
        try {
          const text = await decryptGroupPayload(gk, row.iv, row.ciphertext);
          const m: E2eeChatMessage = {
            id: row.client_msg_id ?? row.id,
            clientMsgId: row.client_msg_id ?? row.id,
            fromId: row.sender_id,
            plaintext: text,
            ts: new Date(row.created_at).getTime(),
            mine: row.sender_id === profileId,
          };
          setMessages((prev) => {
            if (prev.some((x) => x.clientMsgId === m.clientMsgId)) return prev;
            return [...prev, m].sort((a, b) => a.ts - b.ts);
          });
        } catch {
          /* skip */
        }
        return;
      }

      if (
        commsMode === "dm" &&
        activePeerId &&
        row.recipient_id &&
        ((row.sender_id === activePeerId && row.recipient_id === profileId) ||
          (row.sender_id === profileId && row.recipient_id === activePeerId))
      ) {
        const { text, error } = await decryptDmPayload(
          supabase,
          privateKeyRef.current,
          row.sender_id,
          row.iv,
          row.ciphertext,
        );
        if (error || !text) return;
        const m: E2eeChatMessage = {
          id: row.client_msg_id ?? row.id,
          clientMsgId: row.client_msg_id ?? row.id,
          fromId: row.sender_id,
          plaintext: text,
          ts: new Date(row.created_at).getTime(),
          mine: row.sender_id === profileId,
        };
        setMessages((prev) => {
          if (prev.some((x) => x.clientMsgId === m.clientMsgId)) return prev;
          return [...prev, m].sort((a, b) => a.ts - b.ts);
        });
      }
    },
    [supabase, profileId, commsMode, activePeerId],
  );

  const loadHistory = useCallback(async () => {
    if (!supabase || !profileId || !privateKeyRef.current) return;
    seenRef.current.clear();
    setMessages([]);
    if (commsMode === "dm") setChannelRoster([]);

    if (commsMode === "grp") {
      const { data } = await supabase
        .from("e2ee_comms_envelopes")
        .select("*")
        .eq("group_id", GLOBAL_GROUP_ID)
        .order("created_at", { ascending: true })
        .limit(400);
      for (const row of data ?? []) {
        await applyEnvelopeRow(row as E2eeEnvelopeRow);
      }

      const { data: rosterRows } = await supabase
        .from("e2ee_comms_envelopes")
        .select("sender_id")
        .eq("group_id", GLOBAL_GROUP_ID)
        .order("created_at", { ascending: false })
        .limit(80);
      const seenSenders = new Set<string>();
      const ordered: string[] = [];
      for (const r of rosterRows ?? []) {
        const sid = r.sender_id as string;
        if (!sid || seenSenders.has(sid)) continue;
        seenSenders.add(sid);
        ordered.push(sid);
        if (ordered.length >= 12) break;
      }
      setChannelRoster(ordered);
      return;
    }

    if (!activePeerId) return;
    const { data: a } = await supabase
      .from("e2ee_comms_envelopes")
      .select("*")
      .eq("sender_id", activePeerId)
      .eq("recipient_id", profileId)
      .order("created_at", { ascending: true })
      .limit(400);
    const { data: b } = await supabase
      .from("e2ee_comms_envelopes")
      .select("*")
      .eq("sender_id", profileId)
      .eq("recipient_id", activePeerId)
      .order("created_at", { ascending: true })
      .limit(400);
    const merged = [...(a ?? []), ...(b ?? [])].sort(
      (x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime(),
    );
    for (const row of merged) {
      await applyEnvelopeRow(row as E2eeEnvelopeRow);
    }
  }, [supabase, profileId, commsMode, activePeerId, applyEnvelopeRow]);

  useEffect(() => {
    if (!unlocked || !webOk) return;
    void loadHistory();
  }, [unlocked, webOk, loadHistory]);

  useEffect(() => {
    if (!supabase || !profileId || !unlocked || !webOk) {
      return () => {
        channelRef.current = null;
      };
    }

    const topic =
      commsMode === "grp" ? GROUP_REALTIME_TOPIC : activePeerId ? dmRealtimeTopic(profileId, activePeerId) : null;

    if (!topic) {
      return () => {
        const prev = channelRef.current;
        if (prev) void supabase.removeChannel(prev);
        channelRef.current = null;
      };
    }

    const ch = supabase.channel(topic, { config: { broadcast: { self: true } } });
    ch.on("broadcast", { event: "e2ee" }, ({ payload }) => {
      const p = payload as E2eeBroadcastV1;
      if (!p || p.v !== 1) return;
      void ingestPayload(p);
    });

    void ch.subscribe((status) => {
      if (status === "SUBSCRIBED") channelRef.current = ch;
    });

    return () => {
      void supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [supabase, profileId, unlocked, webOk, commsMode, activePeerId, ingestPayload]);

  /** Live envelope sync: new rows appear in history without reload (RLS-scoped). Requires table in supabase_realtime publication. */
  useEffect(() => {
    if (!supabase || !profileId || !unlocked || !webOk) {
      return () => {};
    }

    const rowFromPayload = (raw: Record<string, unknown>): E2eeEnvelopeRow | null => {
      const id = raw.id;
      const sender_id = raw.sender_id;
      const iv = raw.iv;
      const ciphertext = raw.ciphertext;
      const created_at = raw.created_at;
      if (typeof id !== "string" || typeof sender_id !== "string" || typeof iv !== "string" || typeof ciphertext !== "string" || typeof created_at !== "string") {
        return null;
      }
      return {
        id,
        sender_id,
        recipient_id: typeof raw.recipient_id === "string" ? raw.recipient_id : null,
        group_id: typeof raw.group_id === "string" ? raw.group_id : null,
        iv,
        ciphertext,
        client_msg_id:
          raw.client_msg_id == null ? null : typeof raw.client_msg_id === "string" ? raw.client_msg_id : null,
        created_at,
      };
    };

    const onInsert = (payload: { new?: Record<string, unknown> }) => {
      const row = payload.new ? rowFromPayload(payload.new) : null;
      if (!row) return;
      if (row.group_id === GLOBAL_GROUP_ID && commsMode === "grp") {
        setChannelRoster((prev) => {
          if (prev.includes(row.sender_id)) return prev;
          return [row.sender_id, ...prev].slice(0, 12);
        });
      }
      void applyEnvelopeRow(row);
    };

    const topic =
      commsMode === "grp"
        ? `mm-e2ee-env-pg-grp:${profileId}`
        : activePeerId
          ? `mm-e2ee-env-pg-dm:${profileId}:${activePeerId}`
          : null;

    if (!topic) {
      return () => {};
    }

    const ch = supabase.channel(topic);

    if (commsMode === "grp") {
      ch.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "e2ee_comms_envelopes",
          filter: `group_id=eq.${GLOBAL_GROUP_ID}`,
        },
        (payload) => onInsert(payload as { new?: Record<string, unknown> }),
      );
    } else {
      ch.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "e2ee_comms_envelopes",
          filter: `recipient_id=eq.${profileId}`,
        },
        (payload) => onInsert(payload as { new?: Record<string, unknown> }),
      );
      ch.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "e2ee_comms_envelopes",
          filter: `sender_id=eq.${profileId}`,
        },
        (payload) => onInsert(payload as { new?: Record<string, unknown> }),
      );
    }

    void ch.subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, profileId, unlocked, webOk, commsMode, activePeerId, applyEnvelopeRow]);

  useEffect(() => {
    if (!webOk || typeof window === "undefined") return;
    const onOnline = () => {
      if (supabase && profileId) void flushOutboxQueue(supabase, profileId);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [supabase, profileId, webOk]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && supabase && profileId && webOk) void flushOutboxQueue(supabase, profileId);
    });
    return () => sub.remove();
  }, [supabase, profileId, webOk]);

  const unlockComms = useCallback(async () => {
    if (!profileId || !panelPin.trim()) {
      setStatus("Enter your vault PIN.");
      return;
    }
    setStatus(null);
    const { privateKey, error } = await unlockIdentityPrivateKey(profileId, panelPin.trim());
    if (error || !privateKey) {
      setStatus(error?.message ?? "Unlock failed");
      return;
    }
    privateKeyRef.current = privateKey;
    setPanelPin("");
    await refreshMySpki();
    await syncGroupKey();
    setUnlocked(true);
  }, [profileId, panelPin, refreshMySpki, syncGroupKey]);

  const createIdentity = useCallback(async () => {
    if (!supabase || !profileId || !panelPin.trim()) {
      setStatus("PIN required to wrap private key.");
      return;
    }
    setStatus(null);
    const { error } = await bootstrapIdentityOnDevice(supabase, profileId, panelPin.trim());
    if (error) {
      setStatus(error.message);
      return;
    }
    setHasIdentityDevice(true);
    await unlockComms();
  }, [supabase, profileId, panelPin, unlockComms]);

  const createGlobalChannel = useCallback(async () => {
    if (!supabase || !profileId || !privateKeyRef.current) return;
    const spki = mySpkiRef.current;
    if (!spki) {
      setStatus("Missing public key record");
      return;
    }
    const { groupKey, error } = await initGlobalGroupForAdmin(supabase, profileId, privateKeyRef.current, spki);
    if (error?.message === "GLOBAL_EXISTS" || error?.message.includes("duplicate") || error?.message.includes("unique")) {
      await syncGroupKey();
      setStatus(null);
      return;
    }
    if (error) {
      setStatus(error.message);
      return;
    }
    groupKeyRef.current = groupKey;
    setStatus("Global channel ready.");
  }, [supabase, profileId, syncGroupKey]);

  const inviteToGlobal = useCallback(async () => {
    if (!supabase || !profileId || !privateKeyRef.current || !groupKeyRef.current) return;
    const id = invitePeerId.trim();
    if (!id) return;
    const admin = await isGroupAdmin(supabase, profileId);
    if (!admin) {
      setStatus("Not a group admin");
      return;
    }
    const { error } = await adminInviteMemberToGlobal(
      supabase,
      profileId,
      privateKeyRef.current,
      id,
      groupKeyRef.current,
    );
    if (error) setStatus(error.message);
    else setStatus("Invite wrap stored.");
  }, [supabase, profileId, invitePeerId]);

  const applyPeer = useCallback(() => {
    const id = peerInput.trim();
    if (!id) return;
    setActivePeerId(id);
    setPeerInput("");
  }, [peerInput]);

  const sendText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || !supabase || !profileId || !privateKeyRef.current || !unlocked) return;
      const clientMsgId = newMsgId();

      if (commsMode === "dm") {
        if (!activePeerId) {
          setStatus("Pick a DM peer (UUID).");
          return;
        }
        const enc = await encryptDmPayload(supabase, privateKeyRef.current, activePeerId, text);
        if (enc.error) {
          setStatus(enc.error.message);
          return;
        }
        const payload = buildBroadcast("dm", profileId, enc.ivB64, enc.ctB64, clientMsgId);
        const optimistic: E2eeChatMessage = {
          id: clientMsgId,
          clientMsgId,
          fromId: profileId,
          plaintext: text,
          ts: payload.ts,
          mine: true,
        };
        setMessages((prev) => [...prev, optimistic]);
        seenRef.current.add(clientMsgId);

        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        if (offline) {
          await appendOutbox({
            v: 1,
            payload: {
              recipient_id: activePeerId,
              group_id: null,
              iv: enc.ivB64,
              ciphertext: enc.ctB64,
              client_msg_id: clientMsgId,
            },
          });
          return;
        }

        await supabase.from("e2ee_comms_envelopes").insert({
          sender_id: profileId,
          recipient_id: activePeerId,
          group_id: null,
          iv: enc.ivB64,
          ciphertext: enc.ctB64,
          client_msg_id: clientMsgId,
        });

        const ch = channelRef.current;
        if (ch) await ch.send({ type: "broadcast", event: "e2ee", payload });
        return;
      }

      const gk = groupKeyRef.current;
      if (!gk) {
        setStatus("No group key — initialize or wait for admin wrap.");
        return;
      }
      const enc = await encryptGroupPayload(gk, text);
      const payload = buildBroadcast("grp", profileId, enc.ivB64, enc.ctB64, clientMsgId);
      const optimistic: E2eeChatMessage = {
        id: clientMsgId,
        clientMsgId,
        fromId: profileId,
        plaintext: text,
        ts: payload.ts,
        mine: true,
      };
      setMessages((prev) => [...prev, optimistic]);
      seenRef.current.add(clientMsgId);

      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      if (offline) {
        await appendOutbox({
          v: 1,
          payload: {
            recipient_id: null,
            group_id: GLOBAL_GROUP_ID,
            iv: enc.ivB64,
            ciphertext: enc.ctB64,
            client_msg_id: clientMsgId,
          },
        });
        return;
      }

      await supabase.from("e2ee_comms_envelopes").insert({
        sender_id: profileId,
        recipient_id: null,
        group_id: GLOBAL_GROUP_ID,
        iv: enc.ivB64,
        ciphertext: enc.ctB64,
        client_msg_id: clientMsgId,
      });

      const ch = channelRef.current;
      if (ch) await ch.send({ type: "broadcast", event: "e2ee", payload });
    },
    [supabase, profileId, unlocked, commsMode, activePeerId],
  );

  return {
    webOk,
    commsMode,
    setCommsMode,
    peerInput,
    setPeerInput,
    activePeerId,
    applyPeer,
    messages,
    panelPin,
    setPanelPin,
    unlocked,
    unlockComms,
    createIdentity,
    hasIdentityDevice,
    status,
    setStatus,
    sendText,
    username,
    profileId,
    createGlobalChannel,
    invitePeerId,
    setInvitePeerId,
    inviteToGlobal,
    syncGroupKey,
    channelRoster,
  };
}
