import FontAwesome from "@expo/vector-icons/FontAwesome";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    useColorScheme,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { BottomSheetBackdrop, BottomSheetModal } from "@gorhom/bottom-sheet";

const AnyFlashList: any = FlashList;

import { PanicButton } from "@/components/PanicButton";
import { VaultDriveBreadcrumbs, type VaultCrumb } from "@/components/vault/VaultDriveBreadcrumbs";
import { VaultDriveSidebar, type VaultDriveNav } from "@/components/vault/VaultDriveSidebar";
import { S3MinioDrive } from "@/components/vault/S3MinioDrive";
import { VaultFullBleedDropzone } from "@/components/vault/VaultFullBleedDropzone";
import { VaultLightbox, type VaultLightboxEntry, type VaultLightboxRow } from "@/components/vault/VaultLightbox";
import Colors from "@/constants/Colors";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { useActivityLogger } from "@/hooks/useActivityLogger";
import { decryptUtf8, encryptUtf8 } from "@/lib/crypto/aesGcm";
import { hexToBytes } from "@/lib/crypto/bytes";
import { getMapSharedKeyHex } from "@/lib/env";
import { utf8decode } from "@/lib/crypto/bytes";
import { loadVaultOutbox, type VaultOutboxRecord } from "@/lib/e2ee/localStore";
import {
    loadVaultOpsSnapshot,
    loadVaultPrivateSnapshot,
    saveVaultOpsSnapshot,
    saveVaultPrivateSnapshot,
} from "@/lib/offline/vaultWebCache";
import { isWebOnline } from "@/lib/offline/webOnline";
import { getVaultObjectBlob, removeVaultObjectKeys } from "@/lib/storage";
import {
    OPS_AAD,
    VAULT_FOLDER_NAME_AAD,
    formatAarForDisplay,
    formatIntelReportForDisplay,
    formatMedevacNineLineForDisplay,
    formatMissionForDisplay,
    formatRouteReconForDisplay,
    formatSitrepForDisplay,
    formatSpotrepForDisplay,
    formatTargetPackageForDisplay,
    previewOpsRow,
    type AarPayloadV1,
    type IntelReportPayloadV1,
    type MedevacNineLinePayloadV1,
    type MissionPlanPayloadV1,
    type OpsDocKind,
    type RouteReconPayloadV1,
    type SitrepPayloadV1,
    type SpotrepPayloadV1,
    type TargetPackagePayloadV1,
} from "@/lib/opsReports";
import { insertVaultFolder } from "@/lib/vault/createVaultFolder";
import { getPrivateItemMime } from "@/lib/vault/smartFolder";
import { isRasterImageMime, rasterFileToJpegDataUrlPreview120, rasterFileToWebPThumbnail200 } from "@/lib/vault/thumbnailWeb";
import type { VaultMetaPlainV1, VaultPartition } from "@/lib/vault/vaultConstants";
import { decryptVaultMetaJson, decryptVaultThumbnailToObjectUrl, reencryptVaultMetaWithFilename } from "@/lib/vault/vaultMetaDecrypt";
import { runVaultUpload } from "@/lib/vault/vaultUpload";
import {
    formatOpsVaultHeadline,
    formatVaultListDate,
    vaultItemDisplayName,
} from "@/lib/vaultNaming";
import { resolveMapEncryptKey, useMMStore } from "@/store/mmStore";

type VaultMetadataRow = {
  encrypted_meta: string;
  encrypted_thumbnail: string | null;
  is_folder?: boolean;
  parent_id?: string | null;
  trashed_at?: string | null;
};

type VaultObjectRow = {
  id: string;
  storage_path: string | null;
  vault_partition?: string | null;
  created_at: string;
  folder_id: string | null;
  vault_metadata?: VaultMetadataRow | VaultMetadataRow[] | null;
};

type PrivateListItem =
  | { kind: "remote"; row: VaultObjectRow }
  | { kind: "queued"; rec: VaultOutboxRecord };

type UploadingRow = {
  kind: "uploading";
  uploadId: string;
  name: string;
  mime: string;
  pct: number;
  label: string;
  parentVaultObjectId: string | null;
};

type DriveRow = PrivateListItem | UploadingRow;

function pickVaultMetaRow(row: VaultObjectRow): VaultMetadataRow | null {
  const raw = row.vault_metadata;
  if (!raw) return null;
  const m = Array.isArray(raw) ? raw[0] : raw;
  if (!m || !m.encrypted_meta) return null;
  return m;
}

function vaultMetaDbFields(m: VaultMetadataRow | null): {
  isFolder: boolean;
  parentId: string | null;
  trashedAt: string | null;
} {
  if (!m) return { isFolder: false, parentId: null, trashedAt: null };
  return {
    isFolder: m.is_folder === true,
    parentId: m.parent_id ?? null,
    trashedAt: m.trashed_at ?? null,
  };
}

function rowVaultPartition(r: VaultObjectRow, fallback: string): string {
  if (r.vault_partition === "main" || r.vault_partition === "decoy") return r.vault_partition;
  const p = r.storage_path?.split("/")[1];
  if (p === "main" || p === "decoy") return p;
  return fallback;
}

type VaultFolderRow = { id: string; parent_id: string | null; encrypted_name: string; created_by: string };

type OpsReportRow = {
  id: string;
  encrypted_payload: string;
  created_at: string;
  doc_kind: OpsDocKind;
  author_username: string;
  author_id: string;
};

type VaultSection = "private" | OpsDocKind;

function sectionTitle(s: VaultSection): string {
  switch (s) {
    case "private":
      return "Team drive";
    case "mission_plan":
      return "Mission plans";
    case "sitrep":
      return "SITREPs";
    case "aar":
      return "After action";
    case "target_package":
      return "Target packages";
    case "intel_report":
      return "Intel reports";
    case "spotrep":
      return "SPOTREPs";
    case "medevac_nine_line":
      return "9-line MEDEVAC";
    case "route_recon":
      return "Route recon";
    default:
      return s;
  }
}

/** Ops kinds shown as team “folders” in the unified drive sidebar. */
const OPS_DRIVE_FOLDERS: { id: OpsDocKind; label: string }[] = [
  { id: "mission_plan", label: "Mission plans" },
  { id: "sitrep", label: "SITREPs" },
  { id: "aar", label: "After action" },
  { id: "target_package", label: "Target packages" },
  { id: "intel_report", label: "Intel reports" },
  { id: "spotrep", label: "SPOTREPs" },
  { id: "medevac_nine_line", label: "9-line MEDEVAC" },
  { id: "route_recon", label: "Route recon" },
];

export default function VaultScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);
  const vaultMode = useMMStore((s) => s.vaultMode);
  const key = null;

  const mapKey = useMemo(() => {
    const hex = resolveMapEncryptKey() ?? getMapSharedKeyHex();
    if (!hex || hex.length !== 64) return null;
    try {
      return hexToBytes(hex);
    } catch {
      return null;
    }
  }, [vaultMode]);

  const { logAction } = useActivityLogger();
  const vaultFocusObjectId = useMMStore((s) => s.vaultFocusObjectId);
  const setVaultFocusObjectId = useMMStore((s) => s.setVaultFocusObjectId);

  const [section, setSection] = useState<VaultSection>("private");
  const [rows, setRows] = useState<VaultObjectRow[]>([]);
  const [folders, setFolders] = useState<VaultFolderRow[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  /** Hierarchical vault folders: `vault_objects.id` of the open folder, or null at Team drive root. */
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [driveNav, setDriveNav] = useState<VaultDriveNav>("my");
  const [newFolderModalOpen, setNewFolderModalOpen] = useState(false);
  const [newFolderDraft, setNewFolderDraft] = useState("");
  const [renameTarget, setRenameTarget] = useState<VaultObjectRow | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [moveTarget, setMoveTarget] = useState<VaultObjectRow | null>(null);
  const [moreMenuRow, setMoreMenuRow] = useState<VaultObjectRow | null>(null);
  const moreSheetRef = useRef<BottomSheetModal>(null);
  const moreSheetSnapPoints = useMemo(() => ["40%"], []);
  const [opsRows, setOpsRows] = useState<OpsReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [teamHubOpen, setTeamHubOpen] = useState(false);
  /** Web: index was hydrated from IndexedDB while offline. */
  const [vaultFromCache, setVaultFromCache] = useState(false);
  const viewMode = useMMStore((s) => s.vaultDriveViewMode);
  const setVaultDriveViewMode = useMMStore((s) => s.setVaultDriveViewMode);
  const [vaultQueued, setVaultQueued] = useState<VaultOutboxRecord[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadingRows, setUploadingRows] = useState<UploadingRow[]>([]);
  const [thumbUrlById, setThumbUrlById] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<{ entries: VaultLightboxEntry[]; index: number } | null>(null);
  const lastActivateRef = useRef<{ id: string; t: number }>({ id: "", t: 0 });

  const partition = "main" as VaultPartition;
  const prefix = "main";

  const reloadQueued = useCallback(async () => {
    if (Platform.OS !== "web") {
      setVaultQueued([]);
      return;
    }
    setVaultQueued(await loadVaultOutbox());
  }, []);

  const refreshFolders = useCallback(async (): Promise<VaultFolderRow[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("vault_folders")
      .select("id, parent_id, encrypted_name, created_by")
      .order("created_at", { ascending: true });
    if (error) {
      console.warn(error.message);
      setFolders([]);
      return [];
    }
    const list = (data ?? []) as VaultFolderRow[];
    setFolders(list);
    return list;
  }, [supabase]);

  const refreshPrivate = useCallback(async () => {
    if (Platform.OS === "web" && !isWebOnline() && profileId) {
      const snap = await loadVaultPrivateSnapshot(profileId);
      if (snap) {
        setRows(snap.objects);
        setFolders(snap.folders);
        setVaultFromCache(true);
      } else {
        setVaultFromCache(false);
      }
      return;
    }
    if (!supabase) return;
    const { data, error } = await supabase
      .from("vault_objects")
      .select(
        "id, storage_path, created_at, folder_id, vault_partition, vault_metadata (encrypted_meta, encrypted_thumbnail, is_folder, parent_id, trashed_at)",
      )
      .order("created_at", { ascending: false });
    if (error) {
      Alert.alert("Vault list", error.message);
      return;
    }
    const list = (data ?? []) as VaultObjectRow[];
    setRows(list);
    const folderList = await refreshFolders();
    if (Platform.OS === "web" && profileId) {
      await saveVaultPrivateSnapshot(profileId, list, folderList);
    }
    setVaultFromCache(false);
  }, [supabase, refreshFolders, profileId]);

  const createMapPointsFolder = async () => {
    if (!supabase || !profileId || !mapKey || mapKey.length !== 32) {
      Alert.alert("Map points folder", "Team encryption key required. Unlock vault or use latest build with shared key.");
      return;
    }
    const label = "Map points & team layers";
    const enc = encryptUtf8(mapKey, label, VAULT_FOLDER_NAME_AAD);
    const { error } = await supabase.from("vault_folders").insert({
      parent_id: selectedFolderId,
      encrypted_name: enc,
      created_by: profileId,
    });
    if (error) {
      Alert.alert("Folder", error.message);
      return;
    }
    Alert.alert("Drive", `Created encrypted folder “${label}” in the current location.`);
    setTeamHubOpen(false);
    void refreshPrivate();
  };

  const refreshOps = useCallback(
    async (kind: OpsDocKind) => {
      if (Platform.OS === "web" && !isWebOnline() && profileId) {
        const cached = await loadVaultOpsSnapshot(profileId, kind);
        if (cached != null) {
          setOpsRows(cached as OpsReportRow[]);
          setVaultFromCache(true);
        } else {
          setOpsRows([]);
          setVaultFromCache(false);
        }
        return;
      }
      if (!supabase) return;
      const { data, error } = await supabase
        .from("ops_reports")
        .select("id, encrypted_payload, created_at, doc_kind, author_username, author_id")
        .eq("doc_kind", kind)
        .order("created_at", { ascending: false });
      if (error) {
        Alert.alert("Team reports", error.message);
        setOpsRows([]);
        setVaultFromCache(false);
        return;
      }
      const list = (data ?? []) as OpsReportRow[];
      setOpsRows(list);
      if (Platform.OS === "web" && profileId) {
        await saveVaultOpsSnapshot(profileId, kind, list);
      }
      setVaultFromCache(false);
    },
    [supabase, profileId],
  );

  const refreshCurrentDrive = useCallback(async () => {
    setRefreshing(true);
    try {
      if (section === "private") {
        await reloadQueued();
        await refreshPrivate();
      } else {
        await refreshOps(section);
      }
    } finally {
      setRefreshing(false);
    }
  }, [section, reloadQueued, refreshPrivate, refreshOps]);

  const refresh = useCallback(async () => {
    if (section === "private") await refreshPrivate();
    else await refreshOps(section);
  }, [section, refreshPrivate, refreshOps]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void reloadQueued();
      // Secure-cloud pivot: no vault unlock state to “touch”.
    }, [refresh, reloadQueued, vaultMode]),
  );

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const up = () => {
      void reloadQueued();
      void refreshPrivate();
    };
    window.addEventListener("online", up);
    return () => window.removeEventListener("online", up);
  }, [reloadQueued, refreshPrivate]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const r of rows) {
      const meta = pickVaultMetaRow(r);
      const encT = meta?.encrypted_thumbnail;
      if (!encT) continue;
      const u = decryptVaultThumbnailToObjectUrl(encT);
      if (u) next[r.id] = u;
    }
    setThumbUrlById((prev) => {
      Object.values(prev).forEach((u) => {
        try {
          URL.revokeObjectURL(u);
        } catch {
          /* ignore */
        }
      });
      return next;
    });
    return () => {
      Object.values(next).forEach((u) => {
        try {
          URL.revokeObjectURL(u);
        } catch {
          /* ignore */
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild thumbs when rows change
  }, [rows]);

  const remoteMetaById = useMemo(() => {
    const m = new Map<string, ReturnType<typeof decryptVaultMetaJson>>();
    for (const r of rows) {
      const meta = pickVaultMetaRow(r);
      if (!meta?.encrypted_meta) continue;
      const parsed = decryptVaultMetaJson(meta.encrypted_meta);
      if (parsed) m.set(r.id, parsed);
    }
    return m;
  }, [rows, partition]);

  const formatBytes = (n: number) => {
    if (!Number.isFinite(n) || n <= 0) return "0 B";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < u.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
  };

  const uploadVaultFiles = async (files: { bytes: Uint8Array; name: string; mime?: string; file?: File }[]) => {
    if (!supabase || !profileId) {
      Alert.alert("Vault", "Sign in to add files.");
      return;
    }
    if (Platform.OS !== "web" && !isWebOnline()) {
      Alert.alert("You're offline", "Reconnect to add files to your Vault.");
      return;
    }
    setUploadBusy(true);
    try {
      for (const f of files) {
        const mime = f.mime ?? "application/octet-stream";
        const uploadId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const parentForUpload = section === "private" && driveNav === "my" ? currentFolderId : null;
        setUploadingRows((prev) => [
          ...prev,
          {
            kind: "uploading",
            uploadId,
            name: f.name,
            mime,
            pct: 0,
            label: "Starting…",
            parentVaultObjectId: parentForUpload,
          },
        ]);
        let thumb: Uint8Array | null | undefined;
        let previewUrl: string | null | undefined;
        if (Platform.OS === "web" && f.file && isRasterImageMime(mime)) {
          thumb = await rasterFileToWebPThumbnail200(f.file);
          previewUrl = await rasterFileToJpegDataUrlPreview120(f.file);
        }
        const res = await runVaultUpload(
          {
            supabase,
            profileId,
            partition,
            parentVaultObjectId: section === "private" && driveNav === "my" ? currentFolderId : null,
            allowOfflineQueue: Platform.OS === "web",
            onProgress: (prog) => {
              setUploadingRows((prev) =>
                prev.map((r) => (r.uploadId === uploadId ? { ...r, pct: prog.pct, label: prog.label } : r)),
              );
            },
          },
          {
            filename: f.name,
            mimeType: mime,
            bytes: f.bytes,
            thumbnailWebp: thumb ?? null,
            localPreviewDataUrl: previewUrl ?? null,
          },
        );
        if (!res.ok) {
          setUploadingRows((prev) => prev.filter((r) => r.uploadId !== uploadId));
          Alert.alert("Couldn't add this file", res.error);
          break;
        }
        if (res.ok && !res.queued) void logAction("VAULT_FILE", res.objectId);
        await reloadQueued();
        await refreshPrivate();
        setUploadingRows((prev) => prev.filter((r) => r.uploadId !== uploadId));
      }
    } finally {
      setUploadBusy(false);
    }
  };

  const uploadBytes = async (raw: Uint8Array, name: string, mimeHint?: string, pickedFile?: File) => {
    await uploadVaultFiles([{ bytes: raw, name, mime: mimeHint, file: pickedFile }]);
  };

  const pickDoc = async () => {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const u = r.assets[0];
    const res = await fetch(u.uri);
    const buf = new Uint8Array(await res.arrayBuffer());
    const webFile =
      Platform.OS === "web" && u && typeof u === "object" && "file" in u
        ? (u as { file?: File }).file
        : undefined;
    const name = u.name?.trim() ? u.name : "upload";
    await uploadBytes(buf, name, u.mimeType ?? undefined, webFile);
  };

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    if (r.canceled || !r.assets[0]) return;
    const u = r.assets[0];
    const res = await fetch(u.uri);
    const buf = new Uint8Array(await res.arrayBuffer());
    const webFile =
      Platform.OS === "web" && u && typeof u === "object" && "file" in u
        ? (u as { file?: File }).file
        : undefined;
    const name = (u.fileName && u.fileName.trim()) || "photo.jpg";
    await uploadBytes(buf, name, u.mimeType ?? "image/jpeg", webFile);
  };

  const deletePrivateVaultObject = useCallback(
    async (row: VaultObjectRow) => {
      if (!supabase) return;

      const delRecursive = async (id: string, snapshot: VaultObjectRow[]): Promise<boolean> => {
        const kids = snapshot.filter((r) => (pickVaultMetaRow(r)?.parent_id ?? null) === id);
        for (const k of kids) {
          const ok = await delRecursive(k.id, snapshot);
          if (!ok) return false;
        }
        const r = snapshot.find((x) => x.id === id);
        if (!r) return true;
        if (r.storage_path) {
          const { error: stErr } = await removeVaultObjectKeys(supabase, [r.storage_path]);
          if (stErr) {
            Alert.alert("Storage", stErr.message);
            return false;
          }
        }
        const { error: dbErr } = await supabase.from("vault_objects").delete().eq("id", id);
        if (dbErr) {
          Alert.alert("Vault", dbErr.message);
          return false;
        }
        return true;
      };

      const ok = await delRecursive(row.id, rows);
      if (ok) void refreshPrivate();
    },
    [supabase, rows, refreshPrivate],
  );

  const softTrashVaultObject = useCallback(
    async (row: VaultObjectRow) => {
      if (!supabase) return;
      const { error } = await supabase
        .from("vault_metadata")
        .update({ trashed_at: new Date().toISOString() })
        .eq("vault_object_id", row.id);
      if (error) Alert.alert("Vault", error.message);
      else void refreshPrivate();
    },
    [supabase, refreshPrivate],
  );

  const restoreVaultObject = useCallback(
    async (row: VaultObjectRow) => {
      if (!supabase) return;
      const { error } = await supabase.from("vault_metadata").update({ trashed_at: null }).eq("vault_object_id", row.id);
      if (error) Alert.alert("Vault", error.message);
      else void refreshPrivate();
    },
    [supabase, refreshPrivate],
  );

  const moveVaultObject = useCallback(
    async (row: VaultObjectRow, nextParentId: string | null) => {
      if (!supabase) return;
      if (nextParentId === row.id) return;
      if (nextParentId) {
        let cur: string | null = nextParentId;
        while (cur) {
          if (cur === row.id) {
            Alert.alert("Vault", "You can’t move a folder inside itself.");
            return;
          }
          const parentRow = rows.find((x) => x.id === cur);
          cur = parentRow ? (pickVaultMetaRow(parentRow)?.parent_id ?? null) : null;
        }
      }
      const { error } = await supabase.from("vault_metadata").update({ parent_id: nextParentId }).eq("vault_object_id", row.id);
      if (error) Alert.alert("Vault", error.message);
      else void refreshPrivate();
    },
    [supabase, rows, refreshPrivate],
  );

  const applyRenameVaultObject = useCallback(
    async (row: VaultObjectRow, nextName: string) => {
      if (!supabase) return;
      const raw = pickVaultMetaRow(row);
      if (!raw?.encrypted_meta) return;
      const enc = reencryptVaultMetaWithFilename(raw.encrypted_meta, nextName);
      if (!enc) {
        Alert.alert("Vault", "Couldn’t update that name.");
        return;
      }
      const { error } = await supabase.from("vault_metadata").update({ encrypted_meta: enc }).eq("vault_object_id", row.id);
      if (error) Alert.alert("Vault", error.message);
      else void refreshPrivate();
    },
    [supabase, refreshPrivate],
  );

  const openOpsRow = (row: OpsReportRow) => {
    if (!mapKey || mapKey.length !== 32) {
      Alert.alert(
        "Team reports",
        "Cannot decrypt. Unlock your vault or set EXPO_PUBLIC_MM_MAP_SHARED_KEY to match the author’s key.",
      );
      return;
    }
    if (!supabase) return;
    const own = profileId != null && row.author_id === profileId;
    try {
      const aad = OPS_AAD[row.doc_kind];
      const json = decryptUtf8(mapKey, row.encrypted_payload, aad);
      const rawTitle = previewOpsRow(row.doc_kind, json);
      const disp = formatOpsVaultHeadline(rawTitle);
      let body: string;
      if (row.doc_kind === "mission_plan") {
        body = formatMissionForDisplay(JSON.parse(json) as MissionPlanPayloadV1);
      } else if (row.doc_kind === "sitrep") {
        body = formatSitrepForDisplay(JSON.parse(json) as SitrepPayloadV1);
      } else if (row.doc_kind === "aar") {
        body = formatAarForDisplay(JSON.parse(json) as AarPayloadV1);
      } else if (row.doc_kind === "target_package") {
        body = formatTargetPackageForDisplay(JSON.parse(json) as TargetPackagePayloadV1);
      } else if (row.doc_kind === "intel_report") {
        body = formatIntelReportForDisplay(JSON.parse(json) as IntelReportPayloadV1);
      } else if (row.doc_kind === "spotrep") {
        body = formatSpotrepForDisplay(JSON.parse(json) as SpotrepPayloadV1);
      } else if (row.doc_kind === "medevac_nine_line") {
        body = formatMedevacNineLineForDisplay(JSON.parse(json) as MedevacNineLinePayloadV1);
      } else if (row.doc_kind === "route_recon") {
        body = formatRouteReconForDisplay(JSON.parse(json) as RouteReconPayloadV1);
      } else {
        body = json;
      }
      const alertTitle =
        (disp.subtitle ? `${disp.title} · ${disp.subtitle}` : disp.title) + ` · ${row.author_username}`;
      const buttons: {
        text: string;
        style?: "default" | "cancel" | "destructive";
        onPress?: () => void;
      }[] = [{ text: "Close", style: "cancel" as const }];
      if (own) {
        buttons.push({
          text: "Delete my report",
          style: "destructive",
          onPress: () =>
            Alert.alert("Delete report", "Remove this ciphertext for everyone?", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: async () => {
                  const { error: delErr } = await supabase.from("ops_reports").delete().eq("id", row.id);
                  if (delErr) Alert.alert("Team reports", delErr.message);
                  else void refresh();
                },
              },
            ]),
        });
      }
      Alert.alert(alertTitle, body.slice(0, 4000), buttons);
    } catch {
      if (own) {
        Alert.alert("Team reports", "Decrypt failed (wrong operational key).", [
          { text: "Close", style: "cancel" },
          {
            text: "Delete my report",
            style: "destructive",
            onPress: () =>
              Alert.alert("Delete report", "Remove this ciphertext for everyone?", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: async () => {
                    const { error: delErr } = await supabase.from("ops_reports").delete().eq("id", row.id);
                    if (delErr) Alert.alert("Team reports", delErr.message);
                    else void refresh();
                  },
                },
              ]),
          },
        ]);
      } else {
        Alert.alert("Team reports", "Decrypt failed (wrong operational key).");
      }
    }
  };

  const privateListMerged = useMemo((): PrivateListItem[] => {
    const inPartition = rows.filter((r) => rowVaultPartition(r, prefix) === prefix);

    const queuedScoped =
      driveNav === "my"
        ? vaultQueued.filter((rec) => {
            if (rec.partition !== prefix) return false;
            if (rec.profile_id !== profileId) return false;
            const p = rec.parent_vault_object_id ?? null;
            return (p ?? null) === (currentFolderId ?? null);
          })
        : [];

    const remoteItems: PrivateListItem[] = inPartition.flatMap((row): PrivateListItem[] => {
      const raw = pickVaultMetaRow(row);
      const { isFolder, parentId, trashedAt } = vaultMetaDbFields(raw);

      if (driveNav === "trash") {
        if (!trashedAt) return [];
        return [{ kind: "remote", row }];
      }
      if (trashedAt) return [];

      if (driveNav === "recent") {
        if (isFolder) return [];
        if (!row.storage_path) return [];
        return [{ kind: "remote", row }];
      }

      if ((parentId ?? null) !== (currentFolderId ?? null)) return [];
      return [{ kind: "remote", row }];
    });

    const merged: PrivateListItem[] =
      driveNav === "my" ? [...queuedScoped.map((rec) => ({ kind: "queued" as const, rec })), ...remoteItems] : remoteItems;

    if (driveNav === "recent") {
      const sorted = [...merged].sort((a, b) => {
        const ta = a.kind === "queued" ? a.rec.queued_at : new Date(a.row.created_at).getTime();
        const tb = b.kind === "queued" ? b.rec.queued_at : new Date(b.row.created_at).getTime();
        return tb - ta;
      });
      return sorted.slice(0, 100);
    }

    return merged;
  }, [rows, prefix, vaultQueued, profileId, driveNav, currentFolderId]);

  const privateDriveData = useMemo((): DriveRow[] => {
    const uploadingItems: DriveRow[] = uploadingRows
      .filter((u) => {
        if (section !== "private" || driveNav === "trash") return false;
        if (driveNav === "my")
          return (u.parentVaultObjectId ?? null) === (currentFolderId ?? null);
        /* Recent: show in-progress uploads (folder context is cleared on that nav). */
        if (driveNav === "recent") return true;
        return false;
      })
      .map((u): DriveRow => ({ ...u }));
    const sortedItems = [...privateListMerged].sort((a, b) => {
      const fa =
        a.kind === "remote" && vaultMetaDbFields(pickVaultMetaRow(a.row)).isFolder ? 0 : 1;
      const fb =
        b.kind === "remote" && vaultMetaDbFields(pickVaultMetaRow(b.row)).isFolder ? 0 : 1;
      if (fa !== fb) return fa - fb;
      const na =
        a.kind === "remote"
          ? (remoteMetaById.get(a.row.id)?.filename ??
              vaultItemDisplayName(a.row.storage_path ?? a.row.id).title)
          : a.rec.local_label;
      const nb =
        b.kind === "remote"
          ? (remoteMetaById.get(b.row.id)?.filename ??
              vaultItemDisplayName(b.row.storage_path ?? b.row.id).title)
          : b.rec.local_label;
      return na.localeCompare(nb, undefined, { sensitivity: "base" });
    });
    return [...uploadingItems, ...sortedItems];
  }, [section, uploadingRows, privateListMerged, driveNav, currentFolderId, remoteMetaById]);

  const privateEmptyMessage = useMemo(() => {
    switch (driveNav) {
      case "recent":
        return "No recent files yet.\n\nUpload something to Team drive — it’ll show up here.";
      case "trash":
        return "Trash is empty.";
      default:
        return "This folder is empty.\n\nUse New → Upload file, or drag files anywhere on this screen.";
    }
  }, [driveNav]);

  const vaultBreadcrumbs = useMemo((): VaultCrumb[] => {
    if (driveNav === "recent") return [{ id: "__recent", label: "Recent" }];
    if (driveNav === "trash") return [{ id: "__trash", label: "Trash" }];
    const base: VaultCrumb[] = [{ id: null, label: "Team drive" }];
    if (!currentFolderId) return base;
    const chain: VaultCrumb[] = [];
    let cur: string | null = currentFolderId;
    while (cur) {
      const row = rows.find((r) => r.id === cur);
      if (!row) break;
      const label =
        remoteMetaById.get(row.id)?.filename ?? vaultItemDisplayName(row.storage_path ?? row.id).title;
      chain.push({ id: cur, label });
      cur = pickVaultMetaRow(row)?.parent_id ?? null;
    }
    chain.reverse();
    return [...base, ...chain];
  }, [driveNav, currentFolderId, rows, remoteMetaById]);

  const loadDecrypted = useCallback(
    async (row: VaultLightboxRow) => {
      if (!supabase) throw new Error("Sign in to open this file.");
      if (!row.storage_path) {
        throw new Error("Nothing to open here.");
      }
      const { data: file, error } = await getVaultObjectBlob(supabase, row.storage_path);
      if (error || !file) {
        throw new Error(error?.message ?? "Couldn’t download this file.");
      }
      const plain = new Uint8Array(await file.arrayBuffer());
      const meta = remoteMetaById.get(row.id);
      const mime = meta?.mimeType ?? "application/octet-stream";
      return { bytes: plain, mime };
    },
    [supabase, prefix, remoteMetaById],
  );

  const openPrivateRow = useCallback(
    async (row: VaultObjectRow) => {
      if (Platform.OS === "web" && !isWebOnline()) {
        Alert.alert("You're offline", "Reconnect to open files saved in your Vault.");
        return;
      }
      if (!supabase) {
        Alert.alert("Vault", "Sign in to open this file.");
        return;
      }

      const rawMetaRow = pickVaultMetaRow(row);
      if (vaultMetaDbFields(rawMetaRow).isFolder) return;

      const disp = vaultItemDisplayName(row.storage_path ?? row.id);
      const meta = remoteMetaById.get(row.id);
      const title = meta?.filename ?? disp.title;
      const mimeRaw = meta?.mimeType ?? "application/octet-stream";
      const mime = mimeRaw.toLowerCase();
      const isImage = mime.startsWith("image/");
      const isPdf = mime === "application/pdf" || mime.includes("pdf");

      if (isImage) {
        const metaMap = remoteMetaById as unknown as Map<string, VaultMetaPlainV1 | null>;
        const entries: VaultLightboxEntry[] = [];
        for (const d of privateDriveData) {
          if (d.kind !== "remote") continue;
          const m = getPrivateItemMime(d, metaMap).toLowerCase();
          if (!m.startsWith("image/")) continue;
          const r = d.row;
          const mm = remoteMetaById.get(r.id);
          const t = mm?.filename ?? vaultItemDisplayName(r.storage_path ?? r.id).title;
          const mim = mm?.mimeType ?? "application/octet-stream";
          entries.push({ id: r.id, row: r, title: t, mime: mim });
        }
        const idx = entries.findIndex((e) => e.id === row.id);
        setLightbox({ entries, index: idx >= 0 ? idx : 0 });
        return;
      }

      if (isPdf) {
        setLightbox({
          entries: [{ id: row.id, row, title, mime: mimeRaw }],
          index: 0,
        });
        return;
      }

      setLoading(true);
      try {
        if (!row.storage_path) return;
        const { data: file, error } = await getVaultObjectBlob(supabase, row.storage_path);
        if (error || !file) {
          Alert.alert("Couldn’t open file", error?.message ?? "Something went wrong. Try again.");
          return;
        }
        const plain = new Uint8Array(await file.arrayBuffer());
        const previewText = utf8decode(plain.slice(0, Math.min(4000, plain.length)));
        Alert.alert(
          title + (disp.subtitle ? ` (${disp.subtitle})` : ""),
          `Preview:\n${previewText}${plain.length > 4000 ? "…" : ""}`,
          [
            { text: "Close", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: () => void deletePrivateVaultObject(row),
            },
          ],
        );
      } catch {
        Alert.alert("Unable to unlock file", "Check your connection and try again.");
      } finally {
        setLoading(false);
      }
    },
    [supabase, remoteMetaById, privateDriveData, prefix, deletePrivateVaultObject],
  );

  const openPrivateItem = useCallback((item: PrivateListItem) => {
    if (item.kind === "queued") {
      Alert.alert(
        "Waiting to sync",
        "This file is saved on your device and will finish uploading when you're back online.",
      );
      return;
    }
    void openPrivateRow(item.row);
  }, [openPrivateRow]);

  useEffect(() => {
    if (!vaultFocusObjectId) return;
    setSection("private");
  }, [vaultFocusObjectId]);

  useEffect(() => {
    if (!vaultFocusObjectId || section !== "private") return;
    const hit = rows.find((r) => r.id === vaultFocusObjectId);
    if (!hit) return;
    setVaultFocusObjectId(null);
    if (vaultMetaDbFields(pickVaultMetaRow(hit)).isFolder) setCurrentFolderId(hit.id);
    else void openPrivateRow(hit);
  }, [vaultFocusObjectId, section, rows, setVaultFocusObjectId, openPrivateRow]);

  const handleActivateRemoteRow = useCallback(
    (row: VaultObjectRow) => {
      const { isFolder } = vaultMetaDbFields(pickVaultMetaRow(row));
      const run = () => {
        if (isFolder) setCurrentFolderId(row.id);
        else void openPrivateRow(row);
      };
      if (Platform.OS !== "web") {
        run();
        return;
      }
      const now = Date.now();
      const last = lastActivateRef.current;
      if (last.id === row.id && now - last.t < 420) {
        lastActivateRef.current = { id: "", t: 0 };
        run();
      } else {
        lastActivateRef.current = { id: row.id, t: now };
      }
    },
    [openPrivateRow],
  );

  const submitNewVaultFolder = useCallback(async () => {
    if (!supabase || !profileId) return;
    const label = newFolderDraft.trim();
    if (!label) {
      Alert.alert("New folder", "Enter a name.");
      return;
    }
    const res = await insertVaultFolder({
      supabase,
      profileId,
      partition,
      folderName: label,
      parentVaultObjectId: driveNav === "my" ? currentFolderId : null,
    });
    if (!res.ok) {
      Alert.alert("Folder", res.error);
      return;
    }
    setNewFolderModalOpen(false);
    setNewFolderDraft("");
    void refreshPrivate();
  }, [supabase, profileId, partition, newFolderDraft, driveNav, currentFolderId, refreshPrivate]);

  const moveFolderOptions = useMemo((): { id: string | null; label: string }[] => {
    if (!moveTarget) return [];
    const opts: { id: string | null; label: string }[] = [{ id: null, label: "Team drive (root)" }];
    const blocked = new Set<string>();
    const walk = (id: string) => {
      blocked.add(id);
      for (const r of rows) {
        if ((pickVaultMetaRow(r)?.parent_id ?? null) === id) walk(r.id);
      }
    };
    walk(moveTarget.id);
    for (const r of rows) {
      if (rowVaultPartition(r, prefix) !== prefix) continue;
      if (!vaultMetaDbFields(pickVaultMetaRow(r)).isFolder) continue;
      if (blocked.has(r.id)) continue;
      if (r.id === moveTarget.id) continue;
      const label =
        remoteMetaById.get(r.id)?.filename ?? vaultItemDisplayName(r.storage_path ?? r.id).title;
      opts.push({ id: r.id, label });
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [moveTarget, rows, prefix, remoteMetaById]);

  useEffect(() => {
    if (!moreMenuRow) {
      moreSheetRef.current?.dismiss();
      return;
    }
    moreSheetRef.current?.present();
  }, [moreMenuRow]);

  const folderDisplay = useCallback(
    (f: VaultFolderRow) => {
      if (!mapKey || mapKey.length !== 32) return "Folder";
      try {
        return decryptUtf8(mapKey, f.encrypted_name, VAULT_FOLDER_NAME_AAD);
      } catch {
        return "(folder)";
      }
    },
    [mapKey],
  );

  const opsFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return opsRows;
    return opsRows.filter((r) => {
      if (r.author_username.toLowerCase().includes(q)) return true;
      if (mapKey?.length === 32) {
        try {
          const json = decryptUtf8(mapKey, r.encrypted_payload, OPS_AAD[r.doc_kind]);
          const head = previewOpsRow(r.doc_kind, json);
          const disp = formatOpsVaultHeadline(head);
          return `${disp.title} ${disp.subtitle ?? ""}`.toLowerCase().includes(q);
        } catch {
          return false;
        }
      }
      return false;
    });
  }, [opsRows, query, mapKey]);

  const borderM = TacticalPalette.border;
  const surface = TacticalPalette.elevated;

  const opsKindIcon = (kind: OpsDocKind): ComponentProps<typeof FontAwesome>["name"] => {
    switch (kind) {
      case "mission_plan":
        return "map-marker";
      case "sitrep":
        return "bullhorn";
      case "aar":
        return "history";
      case "target_package":
        return "crosshairs";
      case "intel_report":
        return "eye";
      case "spotrep":
        return "binoculars";
      case "medevac_nine_line":
        return "ambulance";
      case "route_recon":
        return "road";
      default:
        return "file";
    }
  };

  const quickAccessPrivate = useMemo(() => privateListMerged.slice(0, 4), [privateListMerged]);
  const quickAccessOps = useMemo(() => opsFiltered.slice(0, 4), [opsFiltered]);

  const renderPrivateList = ({ item }: { item: PrivateListItem }) => {
    if (item.kind === "queued") {
      const rec = item.rec;
      return (
        <Pressable
          onPress={() => openPrivateItem(item)}
          style={({ pressed }) => [
            styles.driveRow,
            {
              borderColor: borderM,
              backgroundColor: pressed ? TacticalPalette.panel : surface,
            },
          ]}>
          <View style={[styles.iconBubble, { backgroundColor: TacticalPalette.coyote }]}>
            <FontAwesome name="clock-o" size={20} color={TacticalPalette.matteBlack} />
          </View>
          <View style={styles.driveText}>
            <Text style={[styles.driveTitle, { color: p.text }]} numberOfLines={1}>
              {rec.local_label}
            </Text>
            <Text style={[styles.driveMeta, { color: p.tabIconDefault }]} numberOfLines={1}>
              Queued · {formatBytes(rec.local_size)} · {rec.local_mime}
            </Text>
          </View>
          <FontAwesome name="chevron-right" size={14} color={p.tabIconDefault} />
        </Pressable>
      );
    }
    const row = item.row;
    const disp = vaultItemDisplayName(row.storage_path ?? row.id);
    const meta = remoteMetaById.get(row.id);
    const title = meta?.filename ?? disp.title;
    const { isFolder } = vaultMetaDbFields(pickVaultMetaRow(row));
    const sizeBit = meta?.size != null ? formatBytes(meta.size) : disp.subtitle;
    const metaLine = [(isFolder ? "Folder" : sizeBit) ?? "", formatVaultListDate(row.created_at)]
      .filter(Boolean)
      .join(" · ");
    return (
      <View
        style={[
          styles.driveRow,
          { borderColor: borderM, backgroundColor: surface, alignItems: "center" },
        ]}>
        <Pressable
          onPress={() => handleActivateRemoteRow(row)}
          style={({ pressed }) => [{ flex: 1, flexDirection: "row", alignItems: "center", opacity: pressed ? 0.92 : 1 }]}>
          <View
            style={[
              styles.iconBubble,
              { backgroundColor: isFolder ? TacticalPalette.coyote : TacticalPalette.oliveDrab },
            ]}>
            <FontAwesome name={isFolder ? "folder" : "file-o"} size={20} color={TacticalPalette.matteBlack} />
          </View>
          <View style={styles.driveText}>
            <Text style={[styles.driveTitle, { color: p.text }]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[styles.driveMeta, { color: p.tabIconDefault }]} numberOfLines={1}>
              {driveNav === "trash" ? "In Trash" : `Team · ${metaLine}`}
            </Text>
          </View>
        </Pressable>
        <Pressable onPress={() => setMoreMenuRow(row)} hitSlop={12} accessibilityLabel="More options">
          <FontAwesome name="ellipsis-v" size={18} color={p.tabIconDefault} />
        </Pressable>
      </View>
    );
  };

  const renderPrivateGrid = ({ item }: { item: PrivateListItem }) => {
    if (item.kind === "queued") {
      const rec = item.rec;
      const thumb = rec.local_thumb_data_url ? (
        <Image source={{ uri: rec.local_thumb_data_url }} style={styles.gridThumb} />
      ) : (
        <FontAwesome name="clock-o" size={32} color={p.tint} style={{ marginBottom: 10 }} />
      );
      return (
        <Pressable
          onPress={() => openPrivateItem(item)}
          style={({ pressed }) => [
            styles.gridCell,
            {
              borderColor: borderM,
              backgroundColor: pressed ? TacticalPalette.panel : surface,
            },
          ]}>
          {thumb}
          <Text style={[styles.gridTitle, { color: p.text }]} numberOfLines={2}>
            {rec.local_label}
          </Text>
          <Text style={[styles.gridSub, { color: p.tint }]} numberOfLines={1}>
            Queued
          </Text>
          <Text style={[styles.gridMeta, { color: p.tabIconDefault }]} numberOfLines={1}>
            {formatBytes(rec.local_size)}
          </Text>
        </Pressable>
      );
    }
    const row = item.row;
    const disp = vaultItemDisplayName(row.storage_path ?? row.id);
    const meta = remoteMetaById.get(row.id);
    const title = meta?.filename ?? disp.title;
    const { isFolder } = vaultMetaDbFields(pickVaultMetaRow(row));
    const thumbUrl = thumbUrlById[row.id];
    const thumb = isFolder ? (
      <FontAwesome name="folder" size={40} color={p.tint} style={{ marginBottom: 10 }} />
    ) : thumbUrl ? (
      <Image source={{ uri: thumbUrl }} style={styles.gridThumb} />
    ) : (
      <FontAwesome name="file-o" size={32} color={p.tint} style={{ marginBottom: 10 }} />
    );
    return (
      <View style={[styles.gridCell, { borderColor: borderM, backgroundColor: surface }]}>
        <Pressable onPress={() => handleActivateRemoteRow(row)} style={{ width: "100%", alignItems: "center" }}>
          {thumb}
          <Text style={[styles.gridTitle, { color: p.text }]} numberOfLines={2}>
            {title}
          </Text>
          {!isFolder && disp.subtitle && !meta?.filename ? (
            <Text style={[styles.gridSub, { color: p.tint }]} numberOfLines={1}>
              {disp.subtitle}
            </Text>
          ) : null}
          <Text style={[styles.gridMeta, { color: p.tabIconDefault }]} numberOfLines={1}>
            {isFolder
              ? "Folder"
              : [meta?.size != null ? formatBytes(meta.size) : null, formatVaultListDate(row.created_at)]
                  .filter(Boolean)
                  .join(" · ")}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setMoreMenuRow(row)}
          hitSlop={10}
          style={{ position: "absolute", top: 8, right: 8 }}
          accessibilityLabel="More options">
          <FontAwesome name="ellipsis-v" size={16} color={p.tabIconDefault} />
        </Pressable>
      </View>
    );
  };

  const renderPrivateDriveList = ({ item }: { item: DriveRow }) => {
    if (item.kind === "uploading") {
      return (
        <View
          style={[
            styles.driveRow,
            {
              borderColor: borderM,
              backgroundColor: surface,
            },
          ]}>
          <View style={[styles.iconBubble, { backgroundColor: TacticalPalette.accentDim }]}>
            <ActivityIndicator color={TacticalPalette.bone} size="small" />
          </View>
          <View style={[styles.driveText, { flex: 1 }]}>
            <Text style={[styles.driveTitle, { color: p.text }]} numberOfLines={1}>
              {item.name}
            </Text>
            <View
              style={{
                height: 6,
                borderRadius: 3,
                backgroundColor: TacticalPalette.charcoal,
                overflow: "hidden",
                marginTop: 8,
              }}>
              <View
                style={{
                  height: "100%",
                  width: `${Math.round(Math.min(100, Math.max(0, item.pct)))}%`,
                  backgroundColor: TacticalPalette.accent,
                }}
              />
            </View>
            <Text style={[styles.driveMeta, { color: p.tabIconDefault, marginTop: 6 }]} numberOfLines={2}>
              {item.label}
            </Text>
          </View>
        </View>
      );
    }
    return renderPrivateList({ item });
  };

  const renderPrivateDriveGrid = ({ item }: { item: DriveRow }) => {
    if (item.kind === "uploading") {
      return (
        <View
          style={[
            styles.gridCell,
            {
              borderColor: borderM,
              backgroundColor: surface,
            },
          ]}>
          <FontAwesome name="cloud-upload" size={30} color={p.tint} style={{ marginBottom: 8 }} />
          <Text style={[styles.gridTitle, { color: p.text }]} numberOfLines={2}>
            {item.name}
          </Text>
          <View
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: TacticalPalette.charcoal,
              overflow: "hidden",
              width: "100%",
              marginVertical: 8,
            }}>
            <View
              style={{
                height: "100%",
                width: `${Math.round(Math.min(100, Math.max(0, item.pct)))}%`,
                backgroundColor: TacticalPalette.accent,
              }}
            />
          </View>
          <Text style={[styles.gridMeta, { color: p.tabIconDefault }]} numberOfLines={2}>
            {item.label}
          </Text>
        </View>
      );
    }
    return renderPrivateGrid({ item });
  };

  const renderOpsList = ({ item }: { item: OpsReportRow }) => {
    let head = "…";
    if (mapKey?.length === 32) {
      try {
        const json = decryptUtf8(mapKey, item.encrypted_payload, OPS_AAD[item.doc_kind]);
        head = previewOpsRow(item.doc_kind, json);
      } catch {
        head = "(cannot decrypt)";
      }
    }
    const disp = formatOpsVaultHeadline(head);
    const metaLine = [
      disp.subtitle,
      item.author_username,
      formatVaultListDate(item.created_at),
    ]
      .filter(Boolean)
      .join(" · ");
    const icon = opsKindIcon(item.doc_kind);
    return (
      <Pressable
        onPress={() => openOpsRow(item)}
        style={({ pressed }) => [
          styles.driveRow,
          {
            borderColor: borderM,
            backgroundColor: pressed ? TacticalPalette.panel : surface,
          },
        ]}>
        <View style={[styles.iconBubble, { backgroundColor: TacticalPalette.oliveDrab }]}>
          <FontAwesome name={icon} size={20} color={TacticalPalette.bone} />
        </View>
        <View style={styles.driveText}>
          <Text style={[styles.driveTitle, { color: p.text }]} numberOfLines={2}>
            {disp.title}
          </Text>
          <Text style={[styles.driveMeta, { color: p.tabIconDefault }]} numberOfLines={1}>
            {metaLine}
          </Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color={p.tabIconDefault} />
      </Pressable>
    );
  };

  const renderOpsGrid = ({ item }: { item: OpsReportRow }) => {
    let head = "…";
    if (mapKey?.length === 32) {
      try {
        const json = decryptUtf8(mapKey, item.encrypted_payload, OPS_AAD[item.doc_kind]);
        head = previewOpsRow(item.doc_kind, json);
      } catch {
        head = "Locked";
      }
    }
    const disp = formatOpsVaultHeadline(head);
    const icon = opsKindIcon(item.doc_kind);
    return (
      <Pressable
        onPress={() => openOpsRow(item)}
        style={({ pressed }) => [
          styles.gridCell,
          {
            borderColor: borderM,
            backgroundColor: pressed ? TacticalPalette.panel : surface,
          },
        ]}>
        <FontAwesome name={icon} size={28} color={p.tint} style={{ marginBottom: 8 }} />
        <Text style={[styles.gridTitle, { color: p.text }]} numberOfLines={3}>
          {disp.title}
        </Text>
        {disp.subtitle ? (
          <Text style={[styles.gridSub, { color: p.tint }]} numberOfLines={1}>
            {disp.subtitle}
          </Text>
        ) : null}
        <Text style={[styles.gridMeta, { color: p.tabIconDefault }]} numberOfLines={1}>
          {item.author_username}
        </Text>
      </Pressable>
    );
  };

  const emptyCopy =
    section === "private"
      ? "No files yet. Upload photos or documents — they stay encrypted for your team on this partition.\n\nNaming tips: use kebab-case or short callsigns in filenames when you control the source (e.g. charlie-sierra-roster or CS-summary)."
      : "Nothing in this folder. Create items from the Missions tab (mission plan, SITREP, AAR). Titles like charlie-sierra or CS are formatted for quick scanning.";

  const renderQuickPrivate = (item: PrivateListItem) => {
    if (item.kind === "queued") {
      return (
        <Pressable
          key={`q-${item.rec.object_id}`}
          onPress={() => openPrivateItem(item)}
          style={({ pressed }) => [
            styles.quickTile,
            { borderColor: borderM, opacity: pressed ? 0.9 : 1 },
          ]}>
          <FontAwesome name="clock-o" size={18} color={TacticalPalette.accent} />
          <Text style={[styles.quickTileText, { color: p.text }]} numberOfLines={2}>
            {item.rec.local_label}
          </Text>
        </Pressable>
      );
    }
    const row = item.row;
    const disp = vaultItemDisplayName(row.storage_path ?? row.id);
    const meta = remoteMetaById.get(row.id);
    return (
      <Pressable
        key={row.id}
        onPress={() => handleActivateRemoteRow(row)}
        style={({ pressed }) => [
          styles.quickTile,
          { borderColor: borderM, opacity: pressed ? 0.9 : 1 },
        ]}>
        <FontAwesome name="file-o" size={18} color={TacticalPalette.accent} />
        <Text style={[styles.quickTileText, { color: p.text }]} numberOfLines={2}>
          {meta?.filename ?? disp.title}
        </Text>
      </Pressable>
    );
  };

  const renderQuickOps = (item: OpsReportRow) => {
    let head = "…";
    if (mapKey?.length === 32) {
      try {
        const json = decryptUtf8(mapKey, item.encrypted_payload, OPS_AAD[item.doc_kind]);
        head = previewOpsRow(item.doc_kind, json);
      } catch {
        head = "…";
      }
    }
    const disp = formatOpsVaultHeadline(head);
    return (
      <Pressable
        key={item.id}
        onPress={() => openOpsRow(item)}
        style={({ pressed }) => [
          styles.quickTile,
          { borderColor: borderM, opacity: pressed ? 0.9 : 1 },
        ]}>
        <FontAwesome name="folder-open" size={18} color={TacticalPalette.accent} />
        <Text style={[styles.quickTileText, { color: p.text }]} numberOfLines={2}>
          {disp.title}
        </Text>
      </Pressable>
    );
  };

  const onDriveNavChange = (n: VaultDriveNav) => {
    setDriveNav(n);
    if (n !== "my") setCurrentFolderId(null);
  };

  const onVaultCrumbPress = (index: number) => {
    if (driveNav === "recent" || driveNav === "trash") {
      setDriveNav("my");
      setCurrentFolderId(null);
      return;
    }
    if (index === 0) {
      setCurrentFolderId(null);
      return;
    }
    const c = vaultBreadcrumbs[index];
    if (c?.id && c.id !== "__recent" && c.id !== "__trash") setCurrentFolderId(c.id);
  };

  return (
    <View style={[styles.shell, { backgroundColor: p.background }]}>
      {Platform.OS === "web" && vaultFromCache ? (
        <View
          style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            backgroundColor: "rgba(107, 142, 92, 0.16)",
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: borderM,
          }}>
          <Text style={{ color: TacticalPalette.bone, fontSize: 12, lineHeight: 17 }}>
            You’re offline — showing the last saved view of your Vault in this browser. Reconnect to refresh or open
            files.
          </Text>
        </View>
      ) : null}
      <VaultFullBleedDropzone
                disabled={section !== "private" || driveNav === "cloud" || Platform.OS !== "web" || uploadBusy}
        onFiles={(files) => {
          void (async () => {
            const mapped = await Promise.all(
              files.map(async (f) => ({
                bytes: new Uint8Array(await f.arrayBuffer()),
                name: f.name?.trim() ? f.name : "upload",
                mime: f.type || undefined,
                file: f,
              })),
            );
            await uploadVaultFiles(mapped);
          })();
        }}>
        <View style={styles.driveRowLayout}>
          <VaultDriveSidebar
            activeSection={section}
            onSelectSection={(s) => {
              setSection(s);
              if (s === "private") void refreshPrivate();
              else void refreshOps(s);
            }}
            driveNav={driveNav}
            onChangeNav={onDriveNavChange}
            onUploadFile={() => void pickDoc()}
            onNewFolder={() => setNewFolderModalOpen(true)}
            onOpenTeamHub={() => setTeamHubOpen(true)}
            opsFolders={OPS_DRIVE_FOLDERS}
          />
          <View style={[styles.mainCol, { maxWidth: 1200, flex: 1 }]}>
          {section === "private" && driveNav === "cloud" ? (
            <S3MinioDrive />
          ) : (
            <>
          <Text style={[styles.breadcrumb, { color: p.tabIconDefault }]}>
            {(vaultMode ?? "main").toUpperCase()} · {sectionTitle(section)}
            {loading ? " · …" : ""}
          </Text>

          {section === "private" && uploadBusy ? (
            <View style={[styles.uploadBanner, { borderColor: borderM, backgroundColor: TacticalPalette.panel }]}>
              <ActivityIndicator color={TacticalPalette.accent} style={{ marginRight: 10 }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.uploadBannerTitle, { color: p.text }]}>Working on your upload…</Text>
                <Text style={[styles.uploadBannerSub, { color: p.tabIconDefault }]}>
                  Encrypting and saving to Team drive. This can take a moment for large files.
                </Text>
              </View>
            </View>
          ) : null}

          {section === "private" ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                marginBottom: 12,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: borderM,
                paddingBottom: 10,
              }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <VaultDriveBreadcrumbs crumbs={vaultBreadcrumbs} onCrumbPress={onVaultCrumbPress} />
                <Text style={{ color: TacticalPalette.boneMuted, fontSize: 11, marginTop: 4, fontWeight: "700" }}>
                  {Platform.OS === "web" ? "Double-click to open · right for more" : "Tap to open · ⋮ for more"}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh drive"
                onPress={() => void refreshCurrentDrive()}
                disabled={refreshing}
                style={({ pressed }) => [
                  styles.refreshBtn,
                  {
                    opacity: refreshing ? 0.6 : pressed ? 0.88 : 1,
                    borderColor: borderM,
                    backgroundColor: surface,
                  },
                ]}>
                {refreshing ? (
                  <>
                    <ActivityIndicator size="small" color={p.tint} style={{ marginRight: 8 }} />
                    <Text style={{ color: p.text, fontWeight: "800", fontSize: 12 }}>Refreshing…</Text>
                  </>
                ) : (
                  <>
                    <FontAwesome name="refresh" size={16} color={p.tint} style={{ marginRight: 6 }} />
                    <Text style={{ color: p.text, fontWeight: "800", fontSize: 12 }}>Refresh</Text>
                  </>
                )}
              </Pressable>
              <View style={styles.viewToggle}>
                <Pressable
                  onPress={() => void setVaultDriveViewMode("list")}
                  style={[
                    styles.viewBtn,
                    viewMode === "list" && { backgroundColor: TacticalPalette.panel },
                  ]}>
                  <FontAwesome name="list" size={16} color={p.text} />
                </Pressable>
                <Pressable
                  onPress={() => void setVaultDriveViewMode("grid")}
                  style={[
                    styles.viewBtn,
                    viewMode === "grid" && { backgroundColor: TacticalPalette.panel },
                  ]}>
                  <FontAwesome name="th-large" size={16} color={p.text} />
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={[styles.searchBar, { borderColor: borderM, backgroundColor: surface }]}>
              <FontAwesome name="search" size={16} color={p.tabIconDefault} style={{ marginRight: 10 }} />
              <TextInput
                placeholder="Search in this folder"
                placeholderTextColor={TacticalPalette.boneMuted}
                value={query}
                onChangeText={setQuery}
                style={[styles.searchInput, { color: p.text }]}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {query.length ? (
                <Pressable onPress={() => setQuery("")} hitSlop={10}>
                  <Text style={{ color: p.tint, fontWeight: "700" }}>Clear</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh folder"
                onPress={() => void refreshCurrentDrive()}
                disabled={refreshing}
                hitSlop={8}
                style={({ pressed }) => [{ padding: 8, opacity: refreshing || pressed ? 0.7 : 1 }]}>
                {refreshing ? (
                  <ActivityIndicator size="small" color={p.tint} />
                ) : (
                  <FontAwesome name="refresh" size={18} color={p.tint} />
                )}
              </Pressable>
            </View>
          )}

          {(section === "private" ? quickAccessPrivate.length > 0 : quickAccessOps.length > 0) ? (
            <View style={styles.quickSection}>
              <Text style={[styles.quickLabel, { color: p.tabIconDefault }]}>Quick access</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow}>
                {section === "private"
                  ? quickAccessPrivate.map((item) => renderQuickPrivate(item))
                  : quickAccessOps.map((item) => renderQuickOps(item))}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.toolbar}>
            {section === "private" ? (
              <View style={{ flex: 1 }} />
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Refresh folder"
                  onPress={() => void refreshCurrentDrive()}
                  disabled={refreshing}
                  style={({ pressed }) => [
                    styles.refreshBtn,
                    {
                      opacity: refreshing ? 0.6 : pressed ? 0.88 : 1,
                      borderColor: borderM,
                      backgroundColor: surface,
                    },
                  ]}>
                  {refreshing ? (
                    <>
                      <ActivityIndicator size="small" color={p.tint} style={{ marginRight: 8 }} />
                      <Text style={{ color: p.text, fontWeight: "800", fontSize: 12 }}>Refreshing…</Text>
                    </>
                  ) : (
                    <>
                      <FontAwesome name="refresh" size={16} color={p.tint} style={{ marginRight: 6 }} />
                      <Text style={{ color: p.text, fontWeight: "800", fontSize: 12 }}>Refresh</Text>
                    </>
                  )}
                </Pressable>
                <View style={styles.viewToggle}>
                  <Pressable
                    onPress={() => void setVaultDriveViewMode("list")}
                    style={[
                      styles.viewBtn,
                      viewMode === "list" && { backgroundColor: TacticalPalette.panel },
                    ]}>
                    <FontAwesome name="list" size={16} color={p.text} />
                  </Pressable>
                  <Pressable
                    onPress={() => void setVaultDriveViewMode("grid")}
                    style={[
                      styles.viewBtn,
                      viewMode === "grid" && { backgroundColor: TacticalPalette.panel },
                    ]}>
                    <FontAwesome name="th-large" size={16} color={p.text} />
                  </Pressable>
                </View>
              </View>
            )}
            {section === "private" ? (
              <View style={[styles.uploadSplit, { alignItems: "center" }]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void pickPhoto()}
                  style={[styles.uploadChip, { borderColor: p.tint }]}>
                  <FontAwesome name="image" size={14} color={p.tint} style={{ marginRight: 6 }} />
                  <Text style={{ color: p.text, fontWeight: "700", fontSize: 13 }}>Photo</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void pickDoc()}
                  style={[styles.uploadChip, { borderColor: p.tint }]}>
                  <FontAwesome name="file-o" size={14} color={p.tint} style={{ marginRight: 6 }} />
                  <Text style={{ color: p.text, fontWeight: "700", fontSize: 13 }}>File</Text>
                </Pressable>
                <PanicButton variant="compact" />
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1, flexWrap: "wrap" }}>
                <Text style={[styles.teamHint, { color: p.tabIconDefault, flex: 1 }]}>Team folder · shared decrypt key</Text>
                <PanicButton variant="compact" />
              </View>
            )}
          </View>

          {section === "private" ? (
            <AnyFlashList
              style={{ flex: 1 }}
              data={privateDriveData}
              keyExtractor={(i: DriveRow) =>
                i.kind === "uploading"
                  ? `up-${i.uploadId}`
                  : i.kind === "queued"
                    ? `q-${i.rec.object_id}`
                    : i.row.id
              }
              numColumns={viewMode === "grid" ? 2 : 1}
              extraData={`${viewMode}-${driveNav}-${currentFolderId ?? "root"}`}
              columnWrapperStyle={viewMode === "grid" ? styles.gridRow : undefined}
              ItemSeparatorComponent={viewMode === "list" ? () => <View style={{ height: 8 }} /> : undefined}
              refreshing={refreshing}
              onRefresh={() => void refreshCurrentDrive()}
              ListEmptyComponent={
                <Text style={[styles.empty, { color: p.tabIconDefault }]}>{privateEmptyMessage}</Text>
              }
              renderItem={viewMode === "grid" ? renderPrivateDriveGrid : renderPrivateDriveList}
              estimatedItemSize={viewMode === "grid" ? 168 : 92}
            />
          ) : (
            <AnyFlashList
              style={{ flex: 1 }}
              data={opsFiltered}
              keyExtractor={(i: OpsReportRow) => i.id}
              numColumns={viewMode === "grid" ? 2 : 1}
              extraData={`ops-${viewMode}`}
              columnWrapperStyle={viewMode === "grid" ? styles.gridRow : undefined}
              ItemSeparatorComponent={viewMode === "list" ? () => <View style={{ height: 8 }} /> : undefined}
              refreshing={refreshing}
              onRefresh={() => void refreshCurrentDrive()}
              ListEmptyComponent={
                <Text style={[styles.empty, { color: p.tabIconDefault }]}>{emptyCopy}</Text>
              }
              renderItem={viewMode === "grid" ? renderOpsGrid : renderOpsList}
              estimatedItemSize={viewMode === "grid" ? 168 : 92}
            />
          )}
            </>
          )}
          </View>
        </View>
      </VaultFullBleedDropzone>

      <Modal visible={newFolderModalOpen} transparent animationType="fade" onRequestClose={() => setNewFolderModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 }}>
          <View
            style={{
              backgroundColor: TacticalPalette.elevated,
              borderRadius: 14,
              padding: 16,
              borderWidth: 1,
              borderColor: TacticalPalette.border,
              maxWidth: 420,
              alignSelf: "center",
              width: "100%",
            }}>
            <Text style={{ color: TacticalPalette.bone, fontWeight: "900", fontSize: 16, marginBottom: 10 }}>
              New folder
            </Text>
            <TextInput
              value={newFolderDraft}
              onChangeText={setNewFolderDraft}
              placeholder="Folder name"
              placeholderTextColor={TacticalPalette.boneMuted}
              style={{
                borderWidth: 1,
                borderColor: TacticalPalette.border,
                borderRadius: 10,
                padding: 12,
                color: TacticalPalette.bone,
                marginBottom: 14,
              }}
            />
            <View style={{ flexDirection: "row", gap: 14, justifyContent: "flex-end", alignItems: "center" }}>
              <Pressable onPress={() => setNewFolderModalOpen(false)}>
                <Text style={{ color: TacticalPalette.boneMuted, fontWeight: "800" }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => void submitNewVaultFolder()}>
                <Text style={{ color: TacticalPalette.accent, fontWeight: "900" }}>Create</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={renameTarget != null} transparent animationType="fade" onRequestClose={() => setRenameTarget(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 }}>
          <View
            style={{
              backgroundColor: TacticalPalette.elevated,
              borderRadius: 14,
              padding: 16,
              borderWidth: 1,
              borderColor: TacticalPalette.border,
              maxWidth: 420,
              alignSelf: "center",
              width: "100%",
            }}>
            <Text style={{ color: TacticalPalette.bone, fontWeight: "900", fontSize: 16, marginBottom: 10 }}>Rename</Text>
            <TextInput
              value={renameDraft}
              onChangeText={setRenameDraft}
              placeholder="Name"
              placeholderTextColor={TacticalPalette.boneMuted}
              style={{
                borderWidth: 1,
                borderColor: TacticalPalette.border,
                borderRadius: 10,
                padding: 12,
                color: TacticalPalette.bone,
                marginBottom: 14,
              }}
            />
            <View style={{ flexDirection: "row", gap: 14, justifyContent: "flex-end", alignItems: "center" }}>
              <Pressable onPress={() => setRenameTarget(null)}>
                <Text style={{ color: TacticalPalette.boneMuted, fontWeight: "800" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!renameTarget) return;
                  void applyRenameVaultObject(renameTarget, renameDraft);
                  setRenameTarget(null);
                }}>
                <Text style={{ color: TacticalPalette.accent, fontWeight: "900" }}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={moveTarget != null} transparent animationType="fade" onRequestClose={() => setMoveTarget(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 }}>
          <View
            style={{
              backgroundColor: TacticalPalette.elevated,
              borderRadius: 14,
              paddingVertical: 10,
              borderWidth: 1,
              borderColor: TacticalPalette.border,
              maxWidth: 420,
              alignSelf: "center",
              width: "100%",
              maxHeight: "70%",
            }}>
            <Text style={{ color: TacticalPalette.bone, fontWeight: "900", fontSize: 16, paddingHorizontal: 16, paddingBottom: 8 }}>
              Move to…
            </Text>
            <AnyFlashList
              data={moveFolderOptions}
              keyExtractor={(it: { id: string | null; label: string }, idx: number) => `${it.id ?? "root"}-${idx}`}
              renderItem={({ item: opt }: { item: { id: string | null; label: string } }) => (
                <Pressable
                  onPress={() => {
                    if (!moveTarget) return;
                    void moveVaultObject(moveTarget, opt.id);
                    setMoveTarget(null);
                  }}
                  style={{ paddingVertical: 12, paddingHorizontal: 16 }}>
                  <Text style={{ color: TacticalPalette.bone, fontWeight: "700" }}>{opt.label}</Text>
                </Pressable>
              )}
              estimatedItemSize={48}
            />
            <Pressable onPress={() => setMoveTarget(null)} style={{ padding: 14, alignItems: "center" }}>
              <Text style={{ color: TacticalPalette.boneMuted, fontWeight: "800" }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <BottomSheetModal
        ref={moreSheetRef}
        snapPoints={moreSheetSnapPoints}
        onDismiss={() => setMoreMenuRow(null)}
        backdropComponent={(props) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />}
        backgroundStyle={{ backgroundColor: TacticalPalette.elevated, borderColor: TacticalPalette.border, borderWidth: 1 }}
        handleIndicatorStyle={{ backgroundColor: TacticalPalette.boneMuted }}
        // @ts-expect-error - fabric/portal guardrail (prop may be untyped depending on version)
        disableFullWindowOverlay={Platform.OS === "ios"}>
        <View style={{ paddingVertical: 6 }}>
          {moreMenuRow ? (
            <>
              <Pressable
                onPress={() => {
                  const t = remoteMetaById.get(moreMenuRow.id)?.filename ?? "";
                  setRenameDraft(t);
                  setRenameTarget(moreMenuRow);
                  setMoreMenuRow(null);
                }}
                style={{ paddingVertical: 14, paddingHorizontal: 16 }}>
                <Text style={{ color: TacticalPalette.bone, fontWeight: "800" }}>Rename</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setMoveTarget(moreMenuRow);
                  setMoreMenuRow(null);
                }}
                style={{ paddingVertical: 14, paddingHorizontal: 16 }}>
                <Text style={{ color: TacticalPalette.bone, fontWeight: "800" }}>Move to…</Text>
              </Pressable>
              {driveNav === "trash" ? (
                <Pressable
                  onPress={() => {
                    void restoreVaultObject(moreMenuRow);
                    setMoreMenuRow(null);
                  }}
                  style={{ paddingVertical: 14, paddingHorizontal: 16 }}>
                  <Text style={{ color: TacticalPalette.bone, fontWeight: "800" }}>Restore</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => {
                  if (driveNav === "trash") void deletePrivateVaultObject(moreMenuRow);
                  else void softTrashVaultObject(moreMenuRow);
                  setMoreMenuRow(null);
                }}
                style={{ paddingVertical: 14, paddingHorizontal: 16 }}>
                <Text style={{ color: "#e07070", fontWeight: "900" }}>
                  {driveNav === "trash" ? "Delete forever" : "Move to Trash"}
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </BottomSheetModal>

      <VaultLightbox
        visible={lightbox != null && (lightbox.entries?.length ?? 0) > 0}
        onClose={() => setLightbox(null)}
        entries={lightbox?.entries ?? []}
        initialIndex={lightbox?.index ?? 0}
        loadDecrypted={loadDecrypted}
        onDelete={(r) => {
          const row = r as VaultObjectRow;
          if (vaultMetaDbFields(pickVaultMetaRow(row)).trashedAt) void deletePrivateVaultObject(row);
          else void softTrashVaultObject(row);
        }}
      />

      <Modal visible={teamHubOpen} animationType="fade" transparent onRequestClose={() => setTeamHubOpen(false)}>
        <Pressable style={styles.teamHubBackdrop} onPress={() => setTeamHubOpen(false)}>
          <View style={styles.teamHubSheet}>
            <Text style={styles.teamHubTitle}>Team workspace</Text>
            <Text style={styles.teamHubSub}>
              Shared map, missions, and bulletin use the same team crypto key. Open a destination or create a drive
              folder for map-related files.
            </Text>
            <Pressable
              style={styles.teamHubBtn}
              onPress={() => {
                setTeamHubOpen(false);
                router.push("/(app)/map");
              }}>
              <FontAwesome name="map" size={16} color={TacticalPalette.bone} style={{ marginRight: 10 }} />
              <Text style={styles.teamHubBtnTx}>Live map</Text>
            </Pressable>
            <Pressable
              style={styles.teamHubBtn}
              onPress={() => {
                setTeamHubOpen(false);
                router.push("/(app)/missions");
              }}>
              <FontAwesome name="crosshairs" size={16} color={TacticalPalette.bone} style={{ marginRight: 10 }} />
              <Text style={styles.teamHubBtnTx}>Mission plans & operations</Text>
            </Pressable>
            <Pressable
              style={styles.teamHubBtn}
              onPress={() => {
                setTeamHubOpen(false);
                router.push("/(app)/bulletin");
              }}>
              <FontAwesome name="bullhorn" size={16} color={TacticalPalette.bone} style={{ marginRight: 10 }} />
              <Text style={styles.teamHubBtnTx}>Bulletin</Text>
            </Pressable>
            <Pressable
              style={[styles.teamHubBtn, styles.teamHubBtnLast]}
              onPress={() => void createMapPointsFolder()}>
              <FontAwesome name="folder" size={16} color={TacticalPalette.bone} style={{ marginRight: 10 }} />
              <Text style={styles.teamHubBtnTx}>Create “Map points” folder here</Text>
            </Pressable>
            <Pressable onPress={() => setTeamHubOpen(false)} style={{ marginTop: 12, alignItems: "center" }}>
              <Text style={{ color: TacticalPalette.boneMuted, fontWeight: "700" }}>Close</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  driveRowLayout: { flex: 1, flexDirection: "row" },
  mainCol: { flex: 1, paddingHorizontal: 16, paddingTop: 12, alignSelf: "stretch", width: "100%" },
  breadcrumb: { fontSize: 12, fontWeight: "600", marginBottom: 10, letterSpacing: 0.2 },
  uploadBanner: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  uploadBannerTitle: { fontSize: 14, fontWeight: "800" },
  uploadBannerSub: { fontSize: 12, marginTop: 4, lineHeight: 17 },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  quickSection: { marginBottom: 12 },
  quickLabel: { fontSize: 11, fontWeight: "700", marginBottom: 8, letterSpacing: 0.6 },
  quickRow: { flexDirection: "row", gap: 10, paddingBottom: 4 },
  quickTile: {
    width: 120,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: TacticalPalette.elevated,
    gap: 8,
  },
  quickTileText: { fontSize: 12, fontWeight: "600" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 12,
  },
  viewToggle: { flexDirection: "row", borderRadius: 10, overflow: "hidden", gap: 4 },
  viewBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  uploadSplit: { flexDirection: "row", gap: 8, flex: 1, justifyContent: "flex-end", flexWrap: "wrap" },
  uploadChip: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  teamHint: { flex: 1, textAlign: "right", fontSize: 11, fontWeight: "600" },
  driveRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 12,
  },
  iconBubble: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  driveText: { flex: 1, minWidth: 0 },
  driveTitle: { fontSize: 16, fontWeight: "700" },
  driveMeta: { fontSize: 12, marginTop: 4, fontWeight: "500" },
  gridRow: { gap: 10, marginBottom: 10, justifyContent: "space-between" },
  gridCell: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    minHeight: 152,
    marginHorizontal: 4,
    alignItems: "flex-start",
    justifyContent: "flex-start",
    position: "relative",
  },
  gridThumb: {
    width: "100%",
    aspectRatio: 1,
    maxHeight: 140,
    borderRadius: 10,
    marginBottom: 10,
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  gridTitle: { fontSize: 14, fontWeight: "700", width: "100%" },
  gridSub: { fontSize: 13, fontWeight: "800", marginTop: 4, letterSpacing: 0.5 },
  gridMeta: { fontSize: 11, marginTop: 12, fontWeight: "500" },
  empty: { fontSize: 13, lineHeight: 20, marginTop: 24, paddingHorizontal: 4 },
  teamHubBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: 24,
  },
  teamHubSheet: {
    borderRadius: 16,
    padding: 20,
    backgroundColor: TacticalPalette.charcoal,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    maxWidth: 440,
    alignSelf: "center",
    width: "100%",
  },
  teamHubTitle: {
    color: TacticalPalette.bone,
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 8,
  },
  teamHubSub: { color: TacticalPalette.boneMuted, fontSize: 13, lineHeight: 19, marginBottom: 16 },
  teamHubBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: TacticalPalette.accentDim,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  teamHubBtnLast: { backgroundColor: TacticalPalette.oliveDrab },
  teamHubBtnTx: { color: TacticalPalette.bone, fontWeight: "800", fontSize: 15, flex: 1 },
});
