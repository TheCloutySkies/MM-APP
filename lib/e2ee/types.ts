/** Wire / Realtime broadcast payload — ciphertext only. */
export type E2eeBroadcastV1 = {
  v: 1;
  kind: "dm" | "grp";
  from: string;
  ivB64: string;
  ctB64: string;
  ts: number;
  clientMsgId: string;
};

export type E2eeChatMessage = {
  id: string;
  clientMsgId: string;
  fromId: string;
  plaintext: string;
  ts: number;
  mine: boolean;
};

export type E2eeEnvelopeRow = {
  id: string;
  sender_id: string;
  recipient_id: string | null;
  group_id: string | null;
  iv: string;
  ciphertext: string;
  client_msg_id: string | null;
  created_at: string;
};

export const GLOBAL_GROUP_ID = "global";
