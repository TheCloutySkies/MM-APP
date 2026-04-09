export const ACTIVITY_LOG_PAYLOAD_VERSION = 1 as const;

export type ActivityLogType = "MAP_PIN" | "VAULT_FILE";

/** Plaintext JSON shape before AES-GCM (team key). */
export type ActivityLogPlainPayloadV1 = {
  v: typeof ACTIVITY_LOG_PAYLOAD_VERSION;
  type: ActivityLogType;
  /** Target row id (map_markers.id or vault_objects.id). */
  ref: string;
  text: string;
  ts: number;
};

export type ActivityLogRow = {
  id: string;
  actor_id: string;
  encrypted_payload: string;
  created_at: string;
};
