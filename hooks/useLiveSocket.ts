import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { getChatEndpoint } from "@/lib/env";
import { useMMStore } from "@/store/mmStore";

export type SocketChatMessage = {
  id: string;
  user_id: string;
  display_name: string;
  text: string;
  timestamp: number;
};

type Status = "disconnected" | "connecting" | "connected" | "error";

export function useLiveSocket() {
  const profileId = useMMStore((s) => s.profileId);
  const username = useMMStore((s) => s.username);

  const endpoint = useMemo(() => getChatEndpoint(), []);

  const [status, setStatus] = useState<Status>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<SocketChatMessage[]>([]);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!endpoint || !profileId) return;

    setStatus("connecting");
    setError(null);

    const socket = io(endpoint, {
      transports: ["websocket"],
      auth: {
        userId: profileId,
        displayName: (username ?? "").trim() || profileId.slice(0, 8),
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

    socket.on("history", (rows: SocketChatMessage[]) => {
      setMessages(Array.isArray(rows) ? rows : []);
    });

    socket.on("new_message", (row: SocketChatMessage) => {
      setMessages((prev) => {
        const next = [...prev, row];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });
    });

    return () => {
      try {
        socket.removeAllListeners();
        socket.disconnect();
      } catch {
        /* ignore */
      }
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [endpoint, profileId, username]);

  const sendMessage = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t) return;
    const s = socketRef.current;
    if (!s || !s.connected) {
      setError("Not connected to chat server.");
      return;
    }
    s.emit("send_message", { text: t });
  }, []);

  return { status, error, messages, sendMessage, endpoint };
}

