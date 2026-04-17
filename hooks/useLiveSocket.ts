import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { getChatEndpoint } from "@/lib/env";
import { useMMStore } from "@/store/mmStore";

export const GROUP_CHANNEL_ID = "group:global";

export type ChatChannelTab = "group" | "private";

export type LiveAttachment = {
  s3_key: string;
  content_type: string;
  size_bytes?: number;
  filename?: string;
  public_url?: string;
};

export type LiveLocation = {
  lat: number;
  lng: number;
  accuracy_m?: number;
};

export type LiveChatEnvelope = {
  message_id: string;
  channel_id: string;
  channel_type: "group" | "dm";
  sender_user_id: string;
  sender_display_name: string;
  created_at_ms: number;
  kind: "text" | "image" | "file" | "location";
  text: string;
  attachment?: LiveAttachment;
  location?: LiveLocation;
  client_temp_id?: string;
};

export type SendPayload = {
  client_temp_id: string;
  channel_id: string;
  channel_type: "group" | "dm";
  kind: "text" | "image" | "file" | "location";
  text?: string;
  attachment?: LiveAttachment;
  location?: LiveLocation;
};

export type DmPeer = { id: string; displayName: string };

export function dmChannelId(uid1: string, uid2: string): string {
  const [a, b] = [uid1, uid2].sort();
  return `dm:${a}:${b}`;
}

type Status = "disconnected" | "connecting" | "connected" | "error";

type AckResult =
  | { ok: true; server_message_id: string; status: string; created_at_ms: number; client_temp_id: string | null }
  | { ok: false; error?: string };

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useLiveSocket() {
  const profileId = useMMStore((s) => s.profileId);
  const username = useMMStore((s) => s.username);

  const endpoint = useMemo(() => getChatEndpoint(), []);

  const [status, setStatus] = useState<Status>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [channelTab, setChannelTab] = useState<ChatChannelTab>("group");
  const [dmPeer, setDmPeer] = useState<DmPeer | null>(null);
  const [messages, setMessages] = useState<LiveChatEnvelope[]>([]);
  const [readReceipts, setReadReceipts] = useState<Record<string, string>>({});
  /** message_id -> 'sent' | 'delivered' for own messages */
  const [deliveryByMessageId, setDeliveryByMessageId] = useState<Record<string, "sent" | "delivered">>({});

  const socketRef = useRef<Socket | null>(null);
  const activeChannelRef = useRef<string>(GROUP_CHANNEL_ID);

  const displayName = useMemo(
    () => (username ?? "").trim() || (profileId ? profileId.slice(0, 8) : ""),
    [username, profileId],
  );

  const activeChannelId = useMemo(() => {
    if (channelTab === "group") return GROUP_CHANNEL_ID;
    if (!profileId || !dmPeer) return "";
    return dmChannelId(profileId, dmPeer.id);
  }, [channelTab, profileId, dmPeer]);

  useEffect(() => {
    activeChannelRef.current = activeChannelId || GROUP_CHANNEL_ID;
  }, [activeChannelId]);

  useEffect(() => {
    if (!endpoint || !profileId) return;

    setStatus("connecting");
    setError(null);

    const socket = io(endpoint, {
      transports: ["websocket"],
      reconnectionAttempts: 20,
      reconnectionDelay: 800,
      auth: {
        userId: profileId,
        displayName,
      },
    });

    socketRef.current = socket;

    socket.on("connect", () => setStatus("connected"));
    socket.on("disconnect", () => setStatus("disconnected"));
    socket.on("connect_error", (e) => {
      setStatus("error");
      setError(e?.message ?? "Socket connection failed");
    });

    socket.on("error_message", (p: { message?: string }) => {
      setError(p?.message ?? "Server error");
    });

    socket.on("history", (payload: { channel_id?: string; messages?: LiveChatEnvelope[] }) => {
      const cid = payload?.channel_id ?? "";
      const rows = Array.isArray(payload?.messages) ? payload.messages : [];
      if (cid && cid === activeChannelRef.current) {
        setMessages(rows);
      }
    });

    socket.on("receive_message", (row: LiveChatEnvelope) => {
      if (row.channel_id !== activeChannelRef.current) return;
      setMessages((prev) => {
        let next = row.client_temp_id
          ? prev.filter((m) => m.client_temp_id !== row.client_temp_id)
          : prev;
        if (next.some((m) => m.message_id === row.message_id)) return next;
        next = [...next, row];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });
    });

    socket.on(
      "read_receipt",
      (p: { channel_id?: string; user_id?: string; last_read_message_id?: string }) => {
        if (!p?.channel_id || p.channel_id !== activeChannelRef.current) return;
        const uid = p.user_id;
        const mid = p.last_read_message_id;
        if (!uid || !mid) return;
        setReadReceipts((prev) => ({ ...prev, [uid]: mid }));
      },
    );

    return () => {
      try {
        socket.removeAllListeners();
        socket.disconnect();
      } catch {
        /* ignore */
      }
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [endpoint, profileId, displayName]);

  useEffect(() => {
    const s = socketRef.current;
    if (!s?.connected || !activeChannelId) return;
    setMessages([]);
    setReadReceipts({});
    s.emit(
      "join_channel",
      {
        channel_id: activeChannelId,
        channel_type: channelTab === "group" ? "group" : "dm",
      },
      (ack: { ok?: boolean; error?: string } | undefined) => {
        if (ack && ack.ok === false && ack.error) {
          setError(ack.error);
        }
      },
    );
  }, [activeChannelId, channelTab]);

  const sendPayload = useCallback((partial: Omit<SendPayload, "client_temp_id" | "channel_id" | "channel_type">) => {
    return new Promise<AckResult>((resolve) => {
      const s = socketRef.current;
      if (!s?.connected || !activeChannelId || !profileId) {
        setError("Not connected to chat server.");
        resolve({ ok: false, error: "offline" });
        return;
      }
      const client_temp_id = randomId();
      const payload: SendPayload = {
        client_temp_id,
        channel_id: activeChannelId,
        channel_type: channelTab === "group" ? "group" : "dm",
        ...partial,
      };
      const optimistic: LiveChatEnvelope = {
        message_id: `local-${client_temp_id}`,
        channel_id: activeChannelId,
        channel_type: channelTab === "group" ? "group" : "dm",
        sender_user_id: profileId,
        sender_display_name: displayName,
        created_at_ms: Date.now(),
        kind: partial.kind,
        text: partial.text ?? "",
        attachment: partial.attachment,
        location: partial.location,
        client_temp_id,
      };
      setMessages((prev) => [...prev, optimistic]);
      setDeliveryByMessageId((d) => ({ ...d, [optimistic.message_id]: "sent" }));

      const to = setTimeout(() => {
        setMessages((prev) => prev.filter((m) => m.client_temp_id !== client_temp_id));
        setDeliveryByMessageId((d) => {
          const next = { ...d };
          delete next[optimistic.message_id];
          return next;
        });
        resolve({ ok: false, error: "timeout" });
      }, 15_000);

      s.emit("send_message", payload, (ack: AckResult) => {
        clearTimeout(to);
        if (!ack || ack.ok === false) {
          setMessages((prev) => prev.filter((m) => m.client_temp_id !== client_temp_id));
          setDeliveryByMessageId((d) => {
            const next = { ...d };
            delete next[optimistic.message_id];
            return next;
          });
          resolve({ ok: false, error: (ack as { error?: string })?.error ?? "send failed" });
          return;
        }
        const realId = ack.server_message_id;
        setMessages((prev) =>
          prev.map((m) =>
            m.client_temp_id === client_temp_id
              ? {
                  ...m,
                  message_id: realId,
                }
              : m,
          ),
        );
        setDeliveryByMessageId((d) => {
          const next = { ...d };
          delete next[optimistic.message_id];
          next[realId] = "delivered";
          return next;
        });
        resolve(ack);
      });
    });
  }, [activeChannelId, channelTab, profileId, displayName]);

  const sendText = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t) return;
      await sendPayload({ kind: "text", text: t });
    },
    [sendPayload],
  );

  const markRead = useCallback(
    (lastReadMessageId: string) => {
      const s = socketRef.current;
      if (!s?.connected || !activeChannelId || !lastReadMessageId) return;
      s.emit("mark_read", { channel_id: activeChannelId, last_read_message_id: lastReadMessageId });
    },
    [activeChannelId],
  );

  useEffect(() => {
    if (!messages.length || !profileId) return;
    const last = messages[messages.length - 1];
    if (last.message_id.startsWith("local-")) return;
    if (last.sender_user_id !== profileId) {
      markRead(last.message_id);
    }
  }, [messages, profileId, markRead]);

  return {
    status,
    error,
    setError,
    channelTab,
    setChannelTab,
    dmPeer,
    setDmPeer,
    activeChannelId,
    messages,
    readReceipts,
    deliveryByMessageId,
    sendText,
    sendPayload,
    markRead,
    endpoint,
  };
}
