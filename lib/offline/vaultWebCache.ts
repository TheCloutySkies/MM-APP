import type { OpsDocKind } from "@/lib/opsReports";

import { offlineKvGet, offlineKvSet } from "./offlineIdb";

export type VaultObjectRow = { id: string; storage_path: string; created_at: string; folder_id: string | null };

export type VaultFolderRow = { id: string; parent_id: string | null; encrypted_name: string; created_by: string };

export type OpsReportRowCached = {
  id: string;
  encrypted_payload: string;
  created_at: string;
  doc_kind: OpsDocKind;
  author_username: string;
};

type PrivateSnap = { objects: VaultObjectRow[]; folders: VaultFolderRow[]; savedAt: number };

function privateKey(profileId: string) {
  return `snap:vault_private:${profileId}`;
}

function opsKey(profileId: string, kind: OpsDocKind) {
  return `snap:vault_ops:${profileId}:${kind}`;
}

export async function saveVaultPrivateSnapshot(
  profileId: string,
  objects: VaultObjectRow[],
  folders: VaultFolderRow[],
): Promise<void> {
  const payload: PrivateSnap = { objects, folders, savedAt: Date.now() };
  await offlineKvSet(privateKey(profileId), payload);
}

export async function loadVaultPrivateSnapshot(profileId: string): Promise<PrivateSnap | null> {
  return offlineKvGet<PrivateSnap>(privateKey(profileId));
}

export async function saveVaultOpsSnapshot(
  profileId: string,
  kind: OpsDocKind,
  rows: OpsReportRowCached[],
): Promise<void> {
  await offlineKvSet(opsKey(profileId, kind), { rows, savedAt: Date.now() });
}

export async function loadVaultOpsSnapshot(
  profileId: string,
  kind: OpsDocKind,
): Promise<OpsReportRowCached[] | null> {
  const raw = await offlineKvGet<{ rows: OpsReportRowCached[] }>(opsKey(profileId, kind));
  return raw?.rows ?? null;
}
