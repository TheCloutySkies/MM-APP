/** Inline image embedded in encrypted chat plaintext (base64). Keep payloads small for latency + quota. */

export type ChatImagePayloadV1 = {
  v: 1;
  mime: string;
  b64: string;
};

const PREFIX = "MM_CHAT_IMG_V1:";

/** ~280kB raw bytes upper bound after base64 (client should compress before encode). */
export const CHAT_IMAGE_B64_MAX = 380_000;

export function encodeChatImagePayload(p: ChatImagePayloadV1): string {
  return PREFIX + JSON.stringify(p);
}

export function tryParseChatImagePayload(plaintext: string): ChatImagePayloadV1 | null {
  if (!plaintext.startsWith(PREFIX)) return null;
  try {
    const j = JSON.parse(plaintext.slice(PREFIX.length)) as ChatImagePayloadV1;
    if (j?.v !== 1 || typeof j.mime !== "string" || typeof j.b64 !== "string") return null;
    return { v: 1, mime: j.mime, b64: j.b64 };
  } catch {
    return null;
  }
}
