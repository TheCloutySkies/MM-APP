import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import {
    markDmUnverified,
    markDmVerified,
    reconcileDmTrustWithServerKey,
} from "@/lib/e2ee/dmTrustStore";
import {
    adminInviteMemberToGlobal,
    initGlobalGroupForAdmin,
    isGroupAdmin,
    loadGlobalGroupKeyForMember,
} from "@/lib/e2ee/groupKeys";
import {
    bootstrapIdentityOnDevice,
    fetchPeerPublicSpki,
    hasLocalIdentity,
    unlockIdentityPrivateKey,
} from "@/lib/e2ee/identity";
import { appendOutbox, loadOutbox, replaceOutbox } from "@/lib/e2ee/localStore";
import { flushOutboxSequential } from "@/lib/e2ee/outboxSync";
import { formatSecurityPhrase, securityPhraseFromSpkiPair } from "@/lib/e2ee/securityWords";
import { setTeamGroupKeyBridge } from "@/lib/e2ee/teamGroupKeyBridge";
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

function friendlyGroupKeyStatus(raw: string): string {
  const m = raw.trim();
  if (m.includes("No group key wrap") || m.includes("No group key wrap for you")) {
    return "You don’t have team channel access yet. Ask an organizer to add you, then tap Refresh below.";
  }
  if (m.includes("Admin public key missing")) {
    return "The team channel is still starting up. Try Refresh in a moment.";
  }
  if (m.includes("unwrap failed")) {
    return "Couldn’t read the team key. Tap Refresh or sign out and back in.";
  }
  return m;
}

function newMsgId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export type CommsMode = "grp" | "dm";

export type ChatDirectoryPeer = { id: string; username: string };

export type DmTrustVisual = "ok" | "unverified" | "broken";

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
  /** True while first-time bootstrap or PIN unlock is running — prevents double-submit races on slow networks. */
  const [commsPinBusy, setCommsPinBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [hasIdentityDevice, setHasIdentityDevice] = useState(false);
  const [invitePeerId, setInvitePeerId] = useState("");
  /** True after team AES key is loaded (global mode can decrypt/send). */
  const [groupChannelReady, setGroupChannelReady] = useState(false);
  const [commsAdmin, setCommsAdmin] = useState(false);
  /** Global channel only: recent distinct sender_ids (ciphertext envelope metadata — no message content). */
  const [channelRoster, setChannelRoster] = useState<string[]>([]);
  const [directoryPeers, setDirectoryPeers] = useState<ChatDirectoryPeer[]>([]);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [dmTrustVisual, setDmTrustVisual] = useState<DmTrustVisual>("unverified");

  const privateKeyRef = useRef<CryptoKey | null>(null);
  const groupKeyRef = useRef<Uint8Array | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const channelRef = useRef<RealtimeChannel | null>(null);
  /** Synchronous guard: React state updates lag one frame; block re-entrancy immediately. */
  const commsPinBusyRef = useRef(false);
  /** Broadcast channel websocket healthy (SUBSCRIBED). Falls back faster than navigator.onLine alone. */
  const broadcastChannelReadyRef = useRef(false);
  const outboxFlushLockRef = useRef(false);
  /** One decoy email per “halt episode” until flush succeeds again. */
  const decoySentThisHaltRef = useRef(false);
  const mySpkiRef = useRef<string | null>(null);

  const decoyAlertsEnabled = useMMStore((s) => s.decoyAlertsEnabled);

  const [outboxSyncHalted, setOutboxSyncHalted] = useState(false);
  const [outboxSyncHaltKind, setOutboxSyncHaltKind] = useState<"network" | "server" | null>(null);

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
      setGroupChannelReady(false);
      setCommsAdmin(false);
      setDirectoryPeers([]);
      setDirectoryError(null);
      setDmTrustVisual("unverified");
      setOutboxSyncHalted(false);
      setOutboxSyncHaltKind(null);
      decoySentThisHaltRef.current = false;
      setTeamGroupKeyBridge(null);
    }
  }, [vaultMode]);

  const loadDirectory = useCallback(async () => {
    if (!supabase) return;
    setDirectoryError(null);
    const { data, error } = await supabase.rpc("mm_list_chat_peers");
    if (error) {
      setDirectoryPeers([]);
      setDirectoryError(error.message);
      return;
    }
    const rows = (data ?? []) as { id: string; username: string }[];
    setDirectoryPeers(rows.map((r) => ({ id: r.id, username: String(r.username ?? "").trim() || "member" })));
  }, [supabase]);

  useEffect(() => {
    if (!unlocked || !supabase || !webOk) return;
    void loadDirectory();
  }, [unlocked, supabase, webOk, loadDirectory]);

  const usernameForPeerId = useCallback(
    (id: string) => {
      if (!id) return "Unknown";
      if (id === profileId) return username ?? "You";
      const hit = directoryPeers.find((p) => p.id === id);
      return hit?.username ?? "Teammate";
    },
    [directoryPeers, profileId, username],
  );

  const refreshMySpki = useCallback(async () => {
    if (!supabase || !profileId) return;
    const { data } = await supabase
      .from("e2ee_identity_keys")
      .select("public_key_spki")
      .eq("profile_id", profileId)
      .maybeSingle();
    mySpkiRef.current = (data?.public_key_spki as string | undefined) ?? null;
  }, [supabase, profileId]);

  useEffect(() => {
    if (!unlocked || !webOk || !supabase || !profileId || !activePeerId || commsMode !== "dm") {
      setDmTrustVisual("unverified");
      return;
    }
    void (async () => {
      const { spki, error } = await fetchPeerPublicSpki(supabase, activePeerId);
      if (error || !spki) {
        setDmTrustVisual("unverified");
        return;
      }
      const r = await reconcileDmTrustWithServerKey(profileId, activePeerId, spki);
      if (r === "broken") {
        setDmTrustVisual("broken");
        setStatus(
          "This chat’s security words may have changed (new device or server update). Compare words again before trusting sensitive details.",
        );
      } else if (r === "ok") {
        setDmTrustVisual("ok");
      } else {
        setDmTrustVisual("unverified");
      }
    })();
  }, [unlocked, webOk, supabase, profileId, activePeerId, commsMode]);

  const syncGroupKey = useCallback(async () => {
    if (!supabase || !profileId || !privateKeyRef.current) return;
    const { groupKey, error } = await loadGlobalGroupKeyForMember(supabase, profileId, privateKeyRef.current);
    if (error) {
      setGroupChannelReady(false);
      groupKeyRef.current = null;
      setTeamGroupKeyBridge(null);
      setStatus(friendlyGroupKeyStatus(error.message));
      return;
    }
    groupKeyRef.current = groupKey;
    setTeamGroupKeyBridge(groupKey);
    setGroupChannelReady(true);
    setStatus(null);
  }, [supabase, profileId]);

  const flushOutboxWithUi = useCallback(async () => {
    if (!supabase || !profileId || outboxFlushLockRef.current) return;
    outboxFlushLockRef.current = true;
    try {
      const result = await flushOutboxSequential(
        supabase,
        profileId,
        loadOutbox,
        replaceOutbox,
        async (item) => {
          const ch = channelRef.current;
          if (!ch || !broadcastChannelReadyRef.current) return;
          const kind = item.payload.group_id != null ? "grp" : "dm";
          const payload = buildBroadcast(
            kind,
            profileId,
            item.payload.iv,
            item.payload.ciphertext,
            item.payload.client_msg_id,
          );
          await ch.send({ type: "broadcast", event: "e2ee", payload });
        },
      );
      if (result.sentClientMsgIds.length) {
        setMessages((prev) =>
          prev.map((m) =>
            m.mine && result.sentClientMsgIds.includes(m.clientMsgId)
              ? { ...m, deliveryStatus: "sent" as const }
              : m,
          ),
        );
      }

      if (result.haltedWithError) {
        const kind: "network" | "server" =
          result.haltCategory === "network" ? "network" : "server";
        setOutboxSyncHalted(true);
        setOutboxSyncHaltKind(kind);
        if (
          kind === "server" &&
          decoyAlertsEnabled &&
          !decoySentThisHaltRef.current
        ) {
          decoySentThisHaltRef.current = true;
          void supabase.functions.invoke("send-decoy-alert").catch(() => {});
        }
      } else {
        setOutboxSyncHalted(false);
        setOutboxSyncHaltKind(null);
        decoySentThisHaltRef.current = false;
      }
    } finally {
      outboxFlushLockRef.current = false;
    }
  }, [supabase, profileId, decoyAlertsEnabled]);

  const retryOutboxSync = useCallback(async () => {
    await flushOutboxWithUi();
  }, [flushOutboxWithUi]);

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
        .limit(800);
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
      .limit(800);
    const { data: b } = await supabase
      .from("e2ee_comms_envelopes")
      .select("*")
      .eq("sender_id", profileId)
      .eq("recipient_id", activePeerId)
      .order("created_at", { ascending: true })
      .limit(800);
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
  }, [unlocked, webOk, loadHistory, groupChannelReady]);

  useEffect(() => {
    if (!supabase || !profileId || !unlocked || !webOk) {
      return () => {
        channelRef.current = null;
      };
    }

    const topic =
      commsMode === "grp" ? GROUP_REALTIME_TOPIC : activePeerId ? dmRealtimeTopic(profileId, activePeerId) : null;

    if (!topic) {
      broadcastChannelReadyRef.current = false;
      return () => {
        const prev = channelRef.current;
        if (prev) void supabase.removeChannel(prev);
        channelRef.current = null;
        broadcastChannelReadyRef.current = false;
      };
    }

    broadcastChannelReadyRef.current = false;
    const ch = supabase.channel(topic, { config: { broadcast: { self: true } } });
    ch.on("broadcast", { event: "e2ee" }, ({ payload }) => {
      const p = payload as E2eeBroadcastV1;
      if (!p || p.v !== 1) return;
      void ingestPayload(p);
    });

    void ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        broadcastChannelReadyRef.current = true;
        channelRef.current = ch;
        void flushOutboxWithUi();
      } else {
        broadcastChannelReadyRef.current = false;
      }
    });

    return () => {
      broadcastChannelReadyRef.current = false;
      void supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [supabase, profileId, unlocked, webOk, commsMode, activePeerId, ingestPayload, flushOutboxWithUi]);

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
      void flushOutboxWithUi();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flushOutboxWithUi, webOk]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && webOk) void flushOutboxWithUi();
    });
    return () => sub.remove();
  }, [flushOutboxWithUi, webOk]);

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
      return;
    }
    if (error) {
      setStatus(error.message);
      return;
    }
    groupKeyRef.current = groupKey;
    setTeamGroupKeyBridge(groupKey);
    setGroupChannelReady(true);
    setStatus(null);
  }, [supabase, profileId, syncGroupKey]);

  const retryTeamChannel = useCallback(async () => {
    if (!supabase || !profileId) return;
    setStatus(null);
    await syncGroupKey();
    if (!groupKeyRef.current) {
      await createGlobalChannel();
    }
    if (!groupKeyRef.current) {
      setStatus(
        "Still no team access. Ask an organizer to add you to the channel, or wait a minute and tap Refresh again.",
      );
    }
  }, [supabase, profileId, syncGroupKey, createGlobalChannel]);

  /**
   * Core unlock: unwrap identity, load team key, wire realtime. Caller passes the exact PIN string so this stays correct
   * after `await`s (no stale `panelPin` closure) and matches the PIN used for bootstrap in the same tap.
   */
  const performCommsUnlock = useCallback(
    async (pin: string): Promise<{ ok: true } | { ok: false; message: string }> => {
      const trimmed = pin.trim();
      if (!profileId || !trimmed) {
        return { ok: false, message: "Enter the same PIN you use for the vault." };
      }
      const { privateKey, error } = await unlockIdentityPrivateKey(profileId, trimmed);
      if (error || !privateKey) {
        return { ok: false, message: error?.message ?? "Unlock failed" };
      }
      privateKeyRef.current = privateKey;
      await refreshMySpki();
      await syncGroupKey();
      if (!groupKeyRef.current) {
        await createGlobalChannel();
      }
      if (supabase && profileId) {
        const admin = await isGroupAdmin(supabase, profileId);
        setCommsAdmin(admin);
      }
      await loadDirectory();
      setUnlocked(true);
      void flushOutboxWithUi();
      return { ok: true };
    },
    [profileId, refreshMySpki, syncGroupKey, createGlobalChannel, supabase, loadDirectory, flushOutboxWithUi],
  );

  const unlockComms = useCallback(async () => {
    const pin = panelPin.trim();
    if (!profileId || !pin) {
      setStatus("Enter the same PIN you use for the vault.");
      return;
    }
    if (commsPinBusyRef.current) return;
    commsPinBusyRef.current = true;
    setCommsPinBusy(true);
    setStatus(null);
    try {
      const result = await performCommsUnlock(pin);
      if (!result.ok) {
        setStatus(result.message);
        return;
      }
      setPanelPin("");
    } finally {
      commsPinBusyRef.current = false;
      setCommsPinBusy(false);
    }
  }, [profileId, panelPin, performCommsUnlock]);

  const createIdentity = useCallback(async () => {
    if (!supabase || !profileId || !panelPin.trim()) {
      setStatus("Enter your vault PIN to continue.");
      return;
    }
    if (commsPinBusyRef.current) return;
    const pin = panelPin.trim();
    commsPinBusyRef.current = true;
    setCommsPinBusy(true);
    setStatus(null);
    try {
      const { error } = await bootstrapIdentityOnDevice(supabase, profileId, pin);
      if (error) {
        setStatus(error.message);
        return;
      }
      setHasIdentityDevice(true);
      const unlockResult = await performCommsUnlock(pin);
      if (!unlockResult.ok) {
        setStatus(
          unlockResult.message.includes("Wrong PIN") || unlockResult.message.includes("corrupted")
            ? "Setup finished but unlock failed. Try the Unlock chat button with the same PIN."
            : unlockResult.message,
        );
        return;
      }
      setPanelPin("");
    } finally {
      commsPinBusyRef.current = false;
      setCommsPinBusy(false);
    }
  }, [supabase, profileId, panelPin, performCommsUnlock]);

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
    else {
      setStatus("Invite wrap stored.");
      setInvitePeerId("");
    }
  }, [supabase, profileId, invitePeerId]);

  const applyPeer = useCallback(() => {
    const id = peerInput.trim();
    if (!id) return;
    setActivePeerId(id);
    setPeerInput("");
  }, [peerInput]);

  const openDmWith = useCallback(
    (peerId: string) => {
      if (!peerId || peerId === profileId) return;
      setActivePeerId(peerId);
      setCommsMode("dm");
      setStatus(null);
      void (async () => {
        if (!supabase || !profileId) return;
        const { spki, error } = await fetchPeerPublicSpki(supabase, peerId);
        if (!error && spki) {
          await markDmVerified(profileId, peerId, spki);
          setDmTrustVisual("ok");
        }
      })();
    },
    [profileId, supabase],
  );

  const backFromDm = useCallback(() => {
    setActivePeerId(null);
    setStatus(null);
    setCommsMode("grp");
  }, []);

  const reloadChatHistory = useCallback(() => {
    void loadHistory();
  }, [loadHistory]);

  const sendPriorityEmail = useCallback(
    async (targetProfileId: string, excerpt: string) => {
      if (!supabase) return { ok: false as const, message: "Not connected" };
      const { error } = await supabase.functions.invoke("mm-priority-email", {
        body: { target_profile_id: targetProfileId, excerpt: excerpt.trim().slice(0, 2000) },
      });
      if (error) {
        const msg =
          typeof error.message === "string" && error.message
            ? error.message
            : "Couldn’t send priority email (check Resend / function logs).";
        return { ok: false as const, message: msg };
      }
      return { ok: true as const };
    },
    [supabase],
  );

  const buildVerifyPhraseForPeer = useCallback(
    async (peerId: string): Promise<string | null> => {
      if (!supabase || !profileId) return null;
      let mine = mySpkiRef.current;
      if (!mine) {
        await refreshMySpki();
        mine = mySpkiRef.current;
      }
      if (!mine) return null;
      const { spki, error } = await fetchPeerPublicSpki(supabase, peerId);
      if (error || !spki) return null;
      const words = await securityPhraseFromSpkiPair(mine, spki);
      return formatSecurityPhrase(words);
    },
    [supabase, profileId, refreshMySpki],
  );

  const applyVerifiedForActiveDm = useCallback(
    async (peerId: string, verified: boolean) => {
      if (!supabase || !profileId) return;
      const { spki, error } = await fetchPeerPublicSpki(supabase, peerId);
      if (error || !spki) return;
      if (verified) {
        await markDmVerified(profileId, peerId, spki);
        setDmTrustVisual("ok");
      } else {
        await markDmUnverified(profileId, peerId, spki);
        setDmTrustVisual("unverified");
      }
    },
    [supabase, profileId],
  );

  const sendChatPlaintext = useCallback(
    async (text: string) => {
      if (!text || !supabase || !profileId || !privateKeyRef.current || !unlocked) return;
      const clientMsgId = newMsgId();
      const netOffline =
        typeof navigator !== "undefined" &&
        typeof navigator.onLine === "boolean" &&
        navigator.onLine === false;
      /** Realtime drops before `navigator.onLine` — only gate on channel when web live comms is active. */
      const realtimeNotReady = webOk && !broadcastChannelReadyRef.current;
      const queueOutbound = netOffline || realtimeNotReady;

      if (commsMode === "dm") {
        if (!activePeerId) {
          setStatus("Tap New message and choose a teammate.");
          return;
        }
        const { spki: peerSpki, error: peerSpkiErr } = await fetchPeerPublicSpki(supabase, activePeerId);
        if (peerSpkiErr || !peerSpki) {
          setStatus(
            "This contact hasn’t opened team chat on a browser yet, or they’re offline. They need one web sign-in so keys sync.",
          );
          return;
        }
        const tr = await reconcileDmTrustWithServerKey(profileId, activePeerId, peerSpki);
        if (tr === "broken") {
          setDmTrustVisual("broken");
          setStatus(
            "Security words for this chat changed — compare Verify words before trusting sensitive information.",
          );
        } else if (tr === "ok") {
          setDmTrustVisual("ok");
        } else {
          setDmTrustVisual("unverified");
        }
        const enc = await encryptDmPayload(supabase, privateKeyRef.current, activePeerId, text, {
          peerSpkiB64: peerSpki,
        });
        if (enc.error) {
          setStatus(
            enc.error.message.includes("Peer") || enc.error.message.includes("key")
              ? "Couldn’t encrypt for this contact. Ask them to open Team chat once on the web."
              : enc.error.message,
          );
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
          deliveryStatus: queueOutbound ? "queued" : "pending",
        };
        setMessages((prev) => [...prev, optimistic]);
        seenRef.current.add(clientMsgId);

        if (queueOutbound) {
          await appendOutbox({
            v: 1,
            queued_at: Date.now(),
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

        const { error: insErr } = await supabase.from("e2ee_comms_envelopes").insert({
          sender_id: profileId,
          recipient_id: activePeerId,
          group_id: null,
          iv: enc.ivB64,
          ciphertext: enc.ctB64,
          client_msg_id: clientMsgId,
        });
        if (insErr) {
          await appendOutbox({
            v: 1,
            queued_at: Date.now(),
            payload: {
              recipient_id: activePeerId,
              group_id: null,
              iv: enc.ivB64,
              ciphertext: enc.ctB64,
              client_msg_id: clientMsgId,
            },
          });
          setMessages((prev) =>
            prev.map((m) =>
              m.clientMsgId === clientMsgId ? { ...m, deliveryStatus: "queued" as const } : m,
            ),
          );
          setStatus("Couldn’t reach server; message queued to send when connected.");
          return;
        }
        setMessages((prev) =>
          prev.map((m) => (m.clientMsgId === clientMsgId ? { ...m, deliveryStatus: "sent" as const } : m)),
        );
        const ch = channelRef.current;
        if (ch) await ch.send({ type: "broadcast", event: "e2ee", payload });
        return;
      }

      const gk = groupKeyRef.current;
      if (!gk) {
        setStatus("Team channel isn’t ready on this device yet. Tap Refresh above or wait for access.");
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
        deliveryStatus: queueOutbound ? "queued" : "pending",
      };
      setMessages((prev) => [...prev, optimistic]);
      seenRef.current.add(clientMsgId);

      if (queueOutbound) {
        await appendOutbox({
          v: 1,
          queued_at: Date.now(),
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

      const { error: grpInsErr } = await supabase.from("e2ee_comms_envelopes").insert({
        sender_id: profileId,
        recipient_id: null,
        group_id: GLOBAL_GROUP_ID,
        iv: enc.ivB64,
        ciphertext: enc.ctB64,
        client_msg_id: clientMsgId,
      });
      if (grpInsErr) {
        await appendOutbox({
          v: 1,
          queued_at: Date.now(),
          payload: {
            recipient_id: null,
            group_id: GLOBAL_GROUP_ID,
            iv: enc.ivB64,
            ciphertext: enc.ctB64,
            client_msg_id: clientMsgId,
          },
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.clientMsgId === clientMsgId ? { ...m, deliveryStatus: "queued" as const } : m,
          ),
        );
        setStatus("Couldn’t reach server; message queued to send when connected.");
        return;
      }
      setMessages((prev) =>
        prev.map((m) => (m.clientMsgId === clientMsgId ? { ...m, deliveryStatus: "sent" as const } : m)),
      );
      const ch = channelRef.current;
      if (ch) await ch.send({ type: "broadcast", event: "e2ee", payload });
    },
    [supabase, profileId, unlocked, commsMode, activePeerId, webOk],
  );

  const sendText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      await sendChatPlaintext(text);
    },
    [sendChatPlaintext],
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
    commsPinBusy,
    unlockComms,
    createIdentity,
    hasIdentityDevice,
    status,
    setStatus,
    sendText,
    /** Send raw body (trimmed by caller); use for vault attachment references. */
    sendMessageBody: sendChatPlaintext,
    username,
    profileId,
    createGlobalChannel,
    invitePeerId,
    setInvitePeerId,
    inviteToGlobal,
    syncGroupKey,
    channelRoster,
    groupChannelReady,
    commsAdmin,
    retryTeamChannel,
    openDmWith,
    backFromDm,
    reloadChatHistory,
    sendPriorityEmail,
    directoryPeers,
    directoryError,
    refreshChatDirectory: loadDirectory,
    usernameForPeerId,
    dmTrustVisual,
    buildVerifyPhraseForPeer,
    applyVerifiedForActiveDm,
    /** Local-only: outbox flush stopped on an error (network vs server classified in outboxSync). */
    outboxSyncHalted,
    outboxSyncHaltKind,
    retryOutboxSync,
  };
}
