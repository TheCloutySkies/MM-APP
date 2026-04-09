import { decryptGroupPayload, encryptGroupPayload } from "@/lib/e2ee/wire";
import { isWebSubtleAvailable } from "@/lib/e2ee/subtleWeb";

import {
  ACTIVITY_LOG_PAYLOAD_VERSION,
  type ActivityLogPlainPayloadV1,
  type ActivityLogType,
} from "@/lib/activityLog/types";

/** Stored in `activity_logs.encrypted_payload` — single JSON text blob. */
export type ActivityEncryptedBundleV1 = {
  v: 1;
  ivB64: string;
  ctB64: string;
};

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

export async function encryptActivityPayloadJson(
  teamKey32: Uint8Array,
  payload: ActivityLogPlainPayloadV1,
): Promise<string | null> {
  if (!isWebSubtleAvailable() || teamKey32.length !== 32) return null;
  const body = JSON.stringify(payload);
  const { ivB64, ctB64 } = await encryptGroupPayload(teamKey32, body);
  const bundle: ActivityEncryptedBundleV1 = { v: 1, ivB64, ctB64 };
  return JSON.stringify(bundle);
}

export async function decryptActivityPayloadJson(
  teamKey32: Uint8Array,
  encryptedPayloadColumn: string,
): Promise<ActivityLogPlainPayloadV1 | null> {
  if (!isWebSubtleAvailable() || teamKey32.length !== 32) return null;
  try {
    const bundle = JSON.parse(encryptedPayloadColumn) as ActivityEncryptedBundleV1;
    if (!bundle?.ivB64 || !bundle?.ctB64) return null;
    const plain = await decryptGroupPayload(teamKey32, bundle.ivB64, bundle.ctB64);
    const o = JSON.parse(plain) as ActivityLogPlainPayloadV1;
    if (o?.v !== ACTIVITY_LOG_PAYLOAD_VERSION || typeof o.ref !== "string" || typeof o.type !== "string") {
      return null;
    }
    return o;
  } catch {
    return null;
  }
}
