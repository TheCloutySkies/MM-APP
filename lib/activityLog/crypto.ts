import {
  ACTIVITY_LOG_PAYLOAD_VERSION,
  type ActivityLogPlainPayloadV1,
  type ActivityLogType,
} from "@/lib/activityLog/types";

export function buildActivityPlaintext(
  type: ActivityLogType,
  ref: string,
  text: string,
): ActivityLogPlainPayloadV1 {
  return {
    v: ACTIVITY_LOG_PAYLOAD_VERSION,
    type,
    ref: ref.trim(),
    text: text.trim(),
    ts: Date.now(),
  };
}

export async function encryptActivityPayloadJson(payload: ActivityLogPlainPayloadV1): Promise<string> {
  // Secure-cloud pivot: store payload as plaintext JSON in `activity_logs.encrypted_payload`.
  return JSON.stringify(payload);
}

export async function decryptActivityPayloadJson(encryptedPayloadColumn: string): Promise<ActivityLogPlainPayloadV1 | null> {
  try {
    const o = JSON.parse(encryptedPayloadColumn) as ActivityLogPlainPayloadV1;
    if (o?.v !== ACTIVITY_LOG_PAYLOAD_VERSION || typeof o.ref !== "string" || typeof o.type !== "string") {
      return null;
    }
    return o;
  } catch {
    return null;
  }
}
