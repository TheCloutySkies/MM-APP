import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getS3AccessKey,
  getS3Bucket,
  getS3Endpoint,
  getS3ForcePathStyle,
  getS3Region,
  getS3SecretKey,
} from "@/lib/env";

let s3Client: S3Client | null = null;

/** Dedupes concurrent HeadBucket/CreateBucket across the app. */
let vaultBucketReadyPromise: Promise<void> | null = null;

export function isVaultS3StorageConfigured(): boolean {
  return Boolean(
    getS3Endpoint()?.trim() &&
      getS3Bucket()?.trim() &&
      getS3AccessKey()?.trim() &&
      getS3SecretKey()?.trim(),
  );
}

function vaultS3Client(): S3Client {
  if (!isVaultS3StorageConfigured()) {
    throw new Error(
      "Vault object storage is not configured (set EXPO_PUBLIC_S3_* for MinIO or another S3-compatible API).",
    );
  }
  if (!s3Client) {
    s3Client = new S3Client({
      region: getS3Region(),
      endpoint: getS3Endpoint()!.replace(/\/$/, ""),
      forcePathStyle: getS3ForcePathStyle(),
      credentials: {
        accessKeyId: getS3AccessKey()!,
        secretAccessKey: getS3SecretKey()!,
      },
    });
  }
  return s3Client;
}

function vaultBucket(): string {
  return getS3Bucket()!.trim();
}

function assertProfileScopedKey(profileId: string, storagePath: string) {
  if (!storagePath.startsWith(`${profileId}/`)) {
    throw new Error("Vault storage keys must start with the signed-in profile id.");
  }
}

function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Unknown storage error";
}

function httpStatus(e: unknown): number | undefined {
  return (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
}

function errName(e: unknown): string | undefined {
  return (e as { name?: string }).name;
}

function isMissingVaultBucketHeadError(e: unknown): boolean {
  const code = httpStatus(e);
  if (code === 404) return true;
  const n = errName(e);
  if (n === "NotFound") return true;
  if (n === "NoSuchBucket") return true;
  return false;
}

function isBucketAlreadyCreatedError(e: unknown): boolean {
  const n = errName(e);
  return n === "BucketAlreadyOwnedByYou" || n === "BucketAlreadyExists";
}

/**
 * Ensures `EXPO_PUBLIC_S3_BUCKET` exists (HeadBucket → CreateBucket). Safe to call many times; runs once in flight.
 * No-op when S3 env is not configured (Supabase Storage path).
 */
async function awaitVaultBucketReady(): Promise<void> {
  if (!isVaultS3StorageConfigured()) return;
  vaultBucketReadyPromise ??= (async () => {
    const client = vaultS3Client();
    const Bucket = vaultBucket();
    try {
      await client.send(new HeadBucketCommand({ Bucket }));
      return;
    } catch (e: unknown) {
      if (!isMissingVaultBucketHeadError(e)) throw e;
    }
    try {
      await client.send(new CreateBucketCommand({ Bucket }));
    } catch (e: unknown) {
      if (isBucketAlreadyCreatedError(e)) return;
      throw e;
    }
  })();
  try {
    await vaultBucketReadyPromise;
  } catch (e: unknown) {
    vaultBucketReadyPromise = null;
    throw e;
  }
}

/**
 * Upload ciphertext JSON (or any vault body bytes) to S3-compatible storage when configured.
 * Intended for **Cloudflare R2** (`region: auto`, virtual-hosted style); see `getS3Region` / `getS3ForcePathStyle` for overrides.
 * Keys must be `{profileId}/…` so objects stay scoped to the signed-in profile.
 */
export async function uploadSecureFile(
  profileId: string,
  storagePath: string,
  body: Uint8Array,
  options: { contentType?: string; upsert: boolean },
): Promise<{ error: { message: string } | null }> {
  try {
    assertProfileScopedKey(profileId, storagePath);
    await awaitVaultBucketReady();
    const client = vaultS3Client();
    const Bucket = vaultBucket();
    if (!options.upsert) {
      try {
        await client.send(new HeadObjectCommand({ Bucket, Key: storagePath }));
        return { error: { message: "That vault object already exists." } };
      } catch (e: unknown) {
        const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status !== 404) return { error: { message: errMsg(e) } };
      }
    }
    await client.send(
      new PutObjectCommand({
        Bucket,
        Key: storagePath,
        Body: body,
        ContentType: options.contentType ?? "application/octet-stream",
      }),
    );
    return { error: null };
  } catch (e: unknown) {
    return { error: { message: errMsg(e) } };
  }
}

export async function downloadSecureFile(storagePath: string): Promise<{ data: Blob | null; error: { message: string } | null }> {
  try {
    await awaitVaultBucketReady();
    const client = vaultS3Client();
    const out = await client.send(new GetObjectCommand({ Bucket: vaultBucket(), Key: storagePath }));
    if (!out.Body) return { data: null, error: { message: "Empty response from storage." } };
    const bytes = new Uint8Array(await out.Body.transformToByteArray());
    return { data: new Blob([bytes]), error: null };
  } catch (e: unknown) {
    return { data: null, error: { message: errMsg(e) } };
  }
}

/** Remove one or more object keys from the vault bucket (S3 only — use `deleteSecureFile` with supabase for fallback). */
export async function deleteSecureFile(keys: string[]): Promise<{ error: { message: string } | null }> {
  if (!keys.length) return { error: null };
  try {
    await awaitVaultBucketReady();
    const client = vaultS3Client();
    const Bucket = vaultBucket();
    const chunk = 1000;
    for (let i = 0; i < keys.length; i += chunk) {
      const slice = keys.slice(i, i + chunk);
      const out = await client.send(
        new DeleteObjectsCommand({
          Bucket,
          Delete: {
            Objects: slice.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
      const first = out.Errors?.[0];
      if (first?.Message) return { error: { message: first.Message } };
    }
    return { error: null };
  } catch (e: unknown) {
    return { error: { message: errMsg(e) } };
  }
}

export type VaultS3ListObject = {
  key: string;
  /** Filename relative to profile prefix (last segment). */
  name: string;
  size: number;
  lastModified: Date | null;
};

/**
 * Lists objects directly under `profileId/` (not recursive into “subfolders” as separate calls).
 * For a flat Drive view of all descendant keys, use `listVaultS3ObjectsFlat`.
 */
export async function listVaultS3ObjectsFlat(profileId: string): Promise<{
  data: VaultS3ListObject[];
  error: { message: string } | null;
}> {
  if (!isVaultS3StorageConfigured()) {
    return { data: [], error: { message: "Vault storage is not configured. Set EXPO_PUBLIC_S3_* (MinIO)." } };
  }
  const pref = `${profileId.replace(/\/$/, "")}/`;
  try {
    await awaitVaultBucketReady();
    const client = vaultS3Client();
    const Bucket = vaultBucket();
    const out: VaultS3ListObject[] = [];
    let ContinuationToken: string | undefined;
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket,
          Prefix: pref,
          ContinuationToken,
        }),
      );
      for (const o of page.Contents ?? []) {
        if (!o.Key || o.Key === pref || o.Key.endsWith("/")) continue;
        const name = o.Key.slice(pref.length);
        if (!name) continue;
        out.push({
          key: o.Key,
          name,
          size: Number(o.Size ?? 0),
          lastModified: o.LastModified ?? null,
        });
      }
      ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
    out.sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0));
    return { data: out, error: null };
  } catch (e: unknown) {
    return { data: [], error: { message: errMsg(e) } };
  }
}

/** Presigned GET for thumbnails / chat images (short TTL). */
export async function getVaultPresignedGetUrl(key: string, expiresInSec = 3600): Promise<{ url: string | null; error: { message: string } | null }> {
  try {
    await awaitVaultBucketReady();
    const client = vaultS3Client();
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: vaultBucket(), Key: key }), {
      expiresIn: expiresInSec,
    });
    return { url, error: null };
  } catch (e: unknown) {
    return { url: null, error: { message: errMsg(e) } };
  }
}

async function listAllKeysWithPrefix(prefix: string): Promise<string[]> {
  await awaitVaultBucketReady();
  const client = vaultS3Client();
  const Bucket = vaultBucket();
  const keys: string[] = [];
  let ContinuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket,
        Prefix: prefix,
        ContinuationToken,
      }),
    );
    for (const o of page.Contents ?? []) {
      if (o.Key) keys.push(o.Key);
    }
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

function pushErr(errors: string[], label: string, message: string | undefined) {
  if (message) errors.push(`${label}: ${message}`);
}

/** Remove every object under `prefix/` (used after DB purge to catch orphans). */
export async function wipeVaultStoragePrefix(
  supabase: SupabaseClient,
  errors: string[],
  prefix: string,
): Promise<void> {
  if (isVaultS3StorageConfigured()) {
    const pref = prefix.endsWith("/") ? prefix : `${prefix}/`;
    try {
      const keys = await listAllKeysWithPrefix(pref);
      if (!keys.length) return;
      const { error } = await deleteSecureFile(keys);
      pushErr(errors, "vault s3 remove (prefix)", error?.message);
    } catch (e: unknown) {
      pushErr(errors, "vault s3 list(prefix)", errMsg(e));
    }
    return;
  }

  const bucket = supabase.storage.from("vault");
  const walk = async (path: string) => {
    const { data, error } = await bucket.list(path, { limit: 1000 });
    if (error) {
      pushErr(errors, `storage.list(${path})`, error.message);
      return;
    }
    const pathsToRemove: string[] = [];
    for (const item of data ?? []) {
      const name = item.name;
      if (!name) continue;
      const full = path ? `${path}/${name}` : name;
      if (name.endsWith(".enc")) {
        pathsToRemove.push(full);
      } else {
        await walk(full);
      }
    }
    if (pathsToRemove.length) {
      const { error: rmErr } = await bucket.remove(pathsToRemove);
      pushErr(errors, "vault.remove", rmErr?.message);
    }
  };
  await walk(prefix);
}

export async function putVaultObject(
  supabase: SupabaseClient,
  profileId: string,
  storagePath: string,
  body: Uint8Array,
  options: { contentType: string; upsert: boolean },
): Promise<{ error: { message: string } | null }> {
  void supabase;
  if (!isVaultS3StorageConfigured()) {
    return { error: { message: "Vault storage is not configured. Set EXPO_PUBLIC_S3_* (MinIO) and retry." } };
  }
  return uploadSecureFile(profileId, storagePath, body, options);
}

export async function getVaultObjectBlob(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<{ data: Blob | null; error: { message: string } | null }> {
  void supabase;
  if (!isVaultS3StorageConfigured()) {
    return { data: null, error: { message: "Vault storage is not configured. Set EXPO_PUBLIC_S3_* (MinIO) and retry." } };
  }
  return downloadSecureFile(storagePath);
}

export async function removeVaultObjectKeys(
  supabase: SupabaseClient,
  keys: string[],
): Promise<{ error: { message: string } | null }> {
  if (!keys.length) return { error: null };
  void supabase;
  if (!isVaultS3StorageConfigured()) {
    return { error: { message: "Vault storage is not configured. Set EXPO_PUBLIC_S3_* (MinIO) and retry." } };
  }
  return deleteSecureFile(keys);
}
