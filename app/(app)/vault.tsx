import FontAwesome from "@expo/vector-icons/FontAwesome";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState, type ComponentProps } from "react";
import {
    Alert,
    FlatList,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    useColorScheme,
    useWindowDimensions,
} from "react-native";

import { PanicButton } from "@/components/PanicButton";
import Colors from "@/constants/Colors";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { aes256GcmDecrypt, aes256GcmEncrypt, decryptUtf8, encryptUtf8, type AeadBundle } from "@/lib/crypto/aesGcm";
import { utf8, utf8decode } from "@/lib/crypto/bytes";
import { runCloutVisionPipeline } from "@/lib/media/cloutVision";
import {
    OPS_AAD,
    VAULT_FOLDER_NAME_AAD,
    formatAarForDisplay,
    formatIntelReportForDisplay,
    formatMissionForDisplay,
    formatSitrepForDisplay,
    formatTargetPackageForDisplay,
    previewOpsRow,
    type AarPayloadV1,
    type IntelReportPayloadV1,
    type MissionPlanPayloadV1,
    type OpsDocKind,
    type SitrepPayloadV1,
    type TargetPackagePayloadV1,
} from "@/lib/opsReports";
import {
    formatOpsVaultHeadline,
    formatVaultListDate,
    vaultItemDisplayName,
} from "@/lib/vaultNaming";
import { resolveMapEncryptKey, useMMStore } from "@/store/mmStore";

type VaultObjectRow = { id: string; storage_path: string; created_at: string; folder_id: string | null };

type VaultFolderRow = { id: string; parent_id: string | null; encrypted_name: string; created_by: string };

type OpsReportRow = {
  id: string;
  encrypted_payload: string;
  created_at: string;
  doc_kind: OpsDocKind;
  author_username: string;
};

type VaultSection = "private" | OpsDocKind;

function useActiveVaultKey() {
  const mode = useMMStore((s) => s.vaultMode);
  const main = useMMStore((s) => s.mainVaultKey);
  const decoy = useMMStore((s) => s.decoyVaultKey);
  if (mode === "main") return main;
  if (mode === "decoy") return decoy;
  return null;
}

function sectionTitle(s: VaultSection): string {
  switch (s) {
    case "private":
      return "My drive";
    case "mission_plan":
      return "Mission plans";
    case "sitrep":
      return "SITREPs";
    case "aar":
      return "After action";
    default:
      return s;
  }
}

function sectionIcon(s: VaultSection): ComponentProps<typeof FontAwesome>["name"] {
  switch (s) {
    case "private":
      return "folder";
    case "mission_plan":
      return "crosshairs";
    case "sitrep":
      return "rss";
    case "aar":
      return "clipboard";
    default:
      return "file";
  }
}

export default function VaultScreen() {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const { width: windowW } = useWindowDimensions();
  const isWideLayout = windowW >= 720;
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);
  const vaultMode = useMMStore((s) => s.vaultMode);
  const touchRealUnlock = useMMStore((s) => s.touchRealUnlock);
  const mainKey = useMMStore((s) => s.mainVaultKey);
  const decoyKey = useMMStore((s) => s.decoyVaultKey);
  const key = useActiveVaultKey();

  const mapKey = useMemo(() => {
    try {
      return resolveMapEncryptKey(mainKey, decoyKey, vaultMode);
    } catch {
      return null;
    }
  }, [mainKey, decoyKey, vaultMode]);

  const [section, setSection] = useState<VaultSection>("private");
  const [rows, setRows] = useState<VaultObjectRow[]>([]);
  const [folders, setFolders] = useState<VaultFolderRow[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [opsRows, setOpsRows] = useState<OpsReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const viewMode = useMMStore((s) => s.vaultDriveViewMode);
  const setVaultDriveViewMode = useMMStore((s) => s.setVaultDriveViewMode);

  const prefix = vaultMode ?? "main";

  const refreshFolders = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("vault_folders")
      .select("id, parent_id, encrypted_name, created_by")
      .order("created_at", { ascending: true });
    if (error) {
      console.warn(error.message);
      setFolders([]);
      return;
    }
    setFolders((data ?? []) as VaultFolderRow[]);
  }, [supabase]);

  const refreshPrivate = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("vault_objects")
      .select("id, storage_path, created_at, folder_id")
      .order("created_at", { ascending: false });
    if (error) {
      Alert.alert("Vault list", error.message);
      return;
    }
    setRows((data ?? []) as VaultObjectRow[]);
    await refreshFolders();
  }, [supabase, refreshFolders]);

  const createFolder = async () => {
    if (!supabase || !profileId || !mapKey || mapKey.length !== 32) {
      Alert.alert("Folders", "Unlock main vault to encrypt folder names.");
      return;
    }
    const label = newFolderName.trim();
    if (!label) {
      Alert.alert("Folders", "Enter a folder name.");
      return;
    }
    const enc = encryptUtf8(mapKey, label, VAULT_FOLDER_NAME_AAD);
    const { error } = await supabase.from("vault_folders").insert({
      parent_id: selectedFolderId,
      encrypted_name: enc,
      created_by: profileId,
    });
    if (error) {
      Alert.alert("Folders", error.message);
      return;
    }
    setNewFolderName("");
    void refreshPrivate();
  };

  const refreshOps = useCallback(
    async (kind: OpsDocKind) => {
      if (!supabase) return;
      const { data, error } = await supabase
        .from("ops_reports")
        .select("id, encrypted_payload, created_at, doc_kind, author_username")
        .eq("doc_kind", kind)
        .order("created_at", { ascending: false });
      if (error) {
        Alert.alert("Team reports", error.message);
        setOpsRows([]);
        return;
      }
      setOpsRows((data ?? []) as OpsReportRow[]);
    },
    [supabase],
  );

  const refresh = useCallback(async () => {
    if (section === "private") await refreshPrivate();
    else await refreshOps(section);
  }, [section, refreshPrivate, refreshOps]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      if (vaultMode === "main") void touchRealUnlock();
    }, [refresh, touchRealUnlock, vaultMode]),
  );

  const uploadBytes = async (raw: Uint8Array, mimeHint?: string) => {
    if (!supabase || !profileId || !key || key.length !== 32) {
      Alert.alert("Vault", "Not ready.");
      return;
    }
    const scrubbed = runCloutVisionPipeline(raw, mimeHint);
    const bundle = aes256GcmEncrypt(key, scrubbed, utf8(`mm-vault/${prefix}`));
    const body = JSON.stringify(bundle);
    const enc = new TextEncoder().encode(body);
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
    const path = `${profileId}/${prefix}/${id}.enc`;
    const { error: upErr } = await supabase.storage.from("vault").upload(path, enc, {
      contentType: "application/octet-stream",
      upsert: false,
    });
    if (upErr) {
      Alert.alert("Upload", upErr.message);
      return;
    }
    const { error: rowErr } = await supabase.from("vault_objects").insert({
      owner_id: profileId,
      storage_path: path,
      folder_id: section === "private" ? selectedFolderId : null,
    });
    if (rowErr) Alert.alert("Vault row", rowErr.message);
    void refreshPrivate();
  };

  const pickDoc = async () => {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const u = r.assets[0];
    const res = await fetch(u.uri);
    const buf = new Uint8Array(await res.arrayBuffer());
    await uploadBytes(buf, u.mimeType ?? undefined);
  };

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    if (r.canceled || !r.assets[0]) return;
    const u = r.assets[0];
    const res = await fetch(u.uri);
    const buf = new Uint8Array(await res.arrayBuffer());
    await uploadBytes(buf, u.mimeType ?? "image/jpeg");
  };

  const openPrivateRow = async (row: VaultObjectRow) => {
    if (!supabase || !key || key.length !== 32) return;
    setLoading(true);
    try {
      const { data: file, error } = await supabase.storage.from("vault").download(row.storage_path);
      if (error || !file) {
        Alert.alert("Download", error?.message ?? "Failed");
        return;
      }
      const txt = await file.text();
      const bundle = JSON.parse(txt) as AeadBundle;
      const plain = aes256GcmDecrypt(key, bundle, utf8(`mm-vault/${prefix}`));
      const preview = utf8decode(plain.slice(0, Math.min(120, plain.length)));
      const disp = vaultItemDisplayName(row.storage_path);
      Alert.alert(
        disp.title + (disp.subtitle ? ` (${disp.subtitle})` : ""),
        `Decrypted ${plain.length} bytes.\n\nPreview:\n${preview}${plain.length > 120 ? "…" : ""}`,
      );
    } catch {
      Alert.alert("Decrypt", "Could not open (wrong vault?).");
    } finally {
      setLoading(false);
    }
  };

  const openOpsRow = (row: OpsReportRow) => {
    if (!mapKey || mapKey.length !== 32) {
      Alert.alert(
        "Team reports",
        "Cannot decrypt. Unlock your vault or set EXPO_PUBLIC_MM_MAP_SHARED_KEY to match the author’s key.",
      );
      return;
    }
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
      } else {
        body = json;
      }
      const alertTitle =
        (disp.subtitle ? `${disp.title} · ${disp.subtitle}` : disp.title) + ` · ${row.author_username}`;
      Alert.alert(alertTitle, body.slice(0, 4000));
    } catch {
      Alert.alert("Team reports", "Decrypt failed (wrong operational key).");
    }
  };

  const privateFiltered = useMemo(() => {
    const base = rows.filter((r) => r.storage_path.includes(`/${prefix}/`));
    const inFolder = base.filter((r) => {
      if (selectedFolderId == null) return r.folder_id == null;
      return r.folder_id === selectedFolderId;
    });
    const q = query.trim().toLowerCase();
    if (!q) return inFolder;
    return inFolder.filter((r) => {
      const disp = vaultItemDisplayName(r.storage_path);
      const hay = `${disp.title} ${disp.subtitle ?? ""} ${r.storage_path}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, prefix, query, selectedFolderId]);

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
  const panelBg = TacticalPalette.panel;

  const quickAccessPrivate = useMemo(() => privateFiltered.slice(0, 4), [privateFiltered]);
  const quickAccessOps = useMemo(() => opsFiltered.slice(0, 4), [opsFiltered]);

  const sidebarNav = (id: VaultSection, label: string) => {
    const active = section === id;
    return (
      <Pressable
        key={id}
        onPress={() => {
          setSection(id);
          if (id === "private") void refreshPrivate();
          else void refreshOps(id);
        }}
        style={({ pressed }) => [
          styles.sideItem,
          {
            borderLeftWidth: 3,
            borderLeftColor: active ? TacticalPalette.accent : "transparent",
            backgroundColor: active ? panelBg : pressed ? TacticalPalette.charcoal : "transparent",
          },
        ]}>
        <FontAwesome
          name={sectionIcon(id)}
          size={18}
          color={active ? TacticalPalette.accent : TacticalPalette.boneMuted}
          style={{ marginRight: isWideLayout ? 12 : 0 }}
        />
        {isWideLayout ? (
          <Text style={{ color: active ? TacticalPalette.bone : TacticalPalette.boneMuted, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>
            {label}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  const renderPrivateList = ({ item }: { item: VaultObjectRow }) => {
    const disp = vaultItemDisplayName(item.storage_path);
    const meta = [disp.subtitle, formatVaultListDate(item.created_at)].filter(Boolean).join(" · ");
    return (
      <Pressable
        onPress={() => void openPrivateRow(item)}
        style={({ pressed }) => [
          styles.driveRow,
          {
            borderColor: borderM,
            backgroundColor: pressed ? TacticalPalette.panel : surface,
          },
        ]}>
        <View style={[styles.iconBubble, { backgroundColor: TacticalPalette.oliveDrab }]}>
          <FontAwesome name="lock" size={20} color={TacticalPalette.bone} />
        </View>
        <View style={styles.driveText}>
          <Text style={[styles.driveTitle, { color: p.text }]} numberOfLines={1}>
            {disp.title}
          </Text>
          <Text style={[styles.driveMeta, { color: p.tabIconDefault }]} numberOfLines={1}>
            You · {meta || formatVaultListDate(item.created_at)}
          </Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color={p.tabIconDefault} />
      </Pressable>
    );
  };

  const renderPrivateGrid = ({ item }: { item: VaultObjectRow }) => {
    const disp = vaultItemDisplayName(item.storage_path);
    return (
      <Pressable
        onPress={() => void openPrivateRow(item)}
        style={({ pressed }) => [
          styles.gridCell,
          {
            borderColor: borderM,
            backgroundColor: pressed ? TacticalPalette.panel : surface,
          },
        ]}>
        <FontAwesome name="file-o" size={32} color={p.tint} style={{ marginBottom: 10 }} />
        <Text style={[styles.gridTitle, { color: p.text }]} numberOfLines={2}>
          {disp.title}
        </Text>
        {disp.subtitle ? (
          <Text style={[styles.gridSub, { color: p.tint }]} numberOfLines={1}>
            {disp.subtitle}
          </Text>
        ) : null}
        <Text style={[styles.gridMeta, { color: p.tabIconDefault }]} numberOfLines={1}>
          {formatVaultListDate(item.created_at)}
        </Text>
      </Pressable>
    );
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
    const icon: ComponentProps<typeof FontAwesome>["name"] =
      item.doc_kind === "mission_plan"
        ? "map-marker"
        : item.doc_kind === "sitrep"
          ? "bullhorn"
          : item.doc_kind === "target_package"
            ? "crosshairs"
            : item.doc_kind === "intel_report"
              ? "eye"
              : "history";
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
    const icon: ComponentProps<typeof FontAwesome>["name"] =
      item.doc_kind === "mission_plan"
        ? "map-marker"
        : item.doc_kind === "sitrep"
          ? "bullhorn"
          : item.doc_kind === "target_package"
            ? "crosshairs"
            : item.doc_kind === "intel_report"
              ? "eye"
              : "history";
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
      ? "No files yet. Upload photos or documents — they stay encrypted in your partition.\n\nNaming tips: use kebab-case or short callsigns in filenames when you control the source (e.g. charlie-sierra-roster or CS-summary)."
      : "Nothing in this folder. Create items from the Missions tab (mission plan, SITREP, AAR). Titles like charlie-sierra or CS are formatted for quick scanning.";

  const renderQuickPrivate = (item: VaultObjectRow) => {
    const disp = vaultItemDisplayName(item.storage_path);
    return (
      <Pressable
        key={item.id}
        onPress={() => void openPrivateRow(item)}
        style={({ pressed }) => [
          styles.quickTile,
          { borderColor: borderM, opacity: pressed ? 0.9 : 1 },
        ]}>
        <FontAwesome name="file-o" size={18} color={TacticalPalette.accent} />
        <Text style={[styles.quickTileText, { color: p.text }]} numberOfLines={2}>
          {disp.title}
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

  return (
    <View style={[styles.shell, { backgroundColor: p.background }]}>
      <View style={styles.driveRowLayout}>
        <View
          style={[
            styles.sidebar,
            {
              width: isWideLayout ? 200 : 56,
              borderRightWidth: StyleSheet.hairlineWidth,
              borderRightColor: borderM,
              backgroundColor: TacticalPalette.charcoal,
            },
          ]}>
          {isWideLayout ? <Text style={styles.sidebarBrand}>Drive</Text> : null}
          {sidebarNav("private", "My drive")}
          {sidebarNav("mission_plan", "Mission plans")}
          {sidebarNav("sitrep", "SITREPs")}
          {sidebarNav("aar", "After action")}
          {section === "private" ? (
            <View style={{ paddingHorizontal: 10, paddingTop: 14, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: borderM, marginTop: 8 }}>
              <Text style={{ color: TacticalPalette.boneMuted, fontSize: 10, fontWeight: "800", letterSpacing: 0.6 }}>
                FOLDERS
              </Text>
              {selectedFolderId != null ? (
                <Pressable
                  onPress={() => {
                    const cur = folders.find((x) => x.id === selectedFolderId);
                    setSelectedFolderId(cur?.parent_id ?? null);
                  }}
                  style={({ pressed }) => ({
                    paddingVertical: 8,
                    paddingHorizontal: 8,
                    borderRadius: 8,
                    backgroundColor: pressed ? TacticalPalette.charcoal : "transparent",
                  })}>
                  <Text style={{ color: TacticalPalette.accent, fontSize: 12, fontWeight: "700" }}>↑ Parent</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => setSelectedFolderId(null)}
                style={({ pressed }) => ({
                  paddingVertical: 8,
                  paddingHorizontal: 8,
                  borderRadius: 8,
                  backgroundColor: selectedFolderId == null ? panelBg : pressed ? TacticalPalette.charcoal : "transparent",
                })}>
                <Text style={{ color: TacticalPalette.bone, fontSize: 12, fontWeight: selectedFolderId == null ? "800" : "600" }}>
                  Root
                </Text>
              </Pressable>
              {folders
                .filter((f) => f.parent_id === selectedFolderId)
                .map((f) => (
                  <Pressable
                    key={f.id}
                    onPress={() => setSelectedFolderId(f.id)}
                    style={({ pressed }) => ({
                      paddingVertical: 8,
                      paddingHorizontal: 8,
                      borderRadius: 8,
                      backgroundColor: pressed ? TacticalPalette.charcoal : "transparent",
                    })}>
                    <Text style={{ color: TacticalPalette.bone, fontSize: 12 }} numberOfLines={1}>
                      {folderDisplay(f)}
                    </Text>
                  </Pressable>
                ))}
              {isWideLayout ? (
                <>
                  <TextInput
                    placeholder="New folder"
                    placeholderTextColor={TacticalPalette.boneMuted}
                    value={newFolderName}
                    onChangeText={setNewFolderName}
                    style={{
                      borderWidth: 1,
                      borderColor: borderM,
                      borderRadius: 8,
                      padding: 8,
                      fontSize: 12,
                      color: TacticalPalette.bone,
                      marginTop: 6,
                    }}
                  />
                  <Pressable
                    onPress={() => void createFolder()}
                    style={{
                      paddingVertical: 10,
                      alignItems: "center",
                      backgroundColor: TacticalPalette.accentDim,
                      borderRadius: 8,
                    }}>
                    <Text style={{ color: TacticalPalette.bone, fontWeight: "800", fontSize: 12 }}>Create encrypted folder</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={[styles.mainCol, { maxWidth: 1200 }]}>
          <Text style={[styles.breadcrumb, { color: p.tabIconDefault }]}>
            {(vaultMode ?? "main").toUpperCase()} · {sectionTitle(section)}
            {loading ? " · …" : ""}
          </Text>

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
          </View>

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
            <FlatList
              style={{ flex: 1 }}
              data={privateFiltered}
              keyExtractor={(i) => i.id}
              numColumns={viewMode === "grid" ? 2 : 1}
              key={viewMode}
              columnWrapperStyle={viewMode === "grid" ? styles.gridRow : undefined}
              ItemSeparatorComponent={viewMode === "list" ? () => <View style={{ height: 8 }} /> : undefined}
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await refreshPrivate();
                setRefreshing(false);
              }}
              ListEmptyComponent={
                <Text style={[styles.empty, { color: p.tabIconDefault }]}>{emptyCopy}</Text>
              }
              renderItem={viewMode === "grid" ? renderPrivateGrid : renderPrivateList}
            />
          ) : (
            <FlatList
              style={{ flex: 1 }}
              data={opsFiltered}
              keyExtractor={(i) => i.id}
              numColumns={viewMode === "grid" ? 2 : 1}
              key={`ops-${viewMode}`}
              columnWrapperStyle={viewMode === "grid" ? styles.gridRow : undefined}
              ItemSeparatorComponent={viewMode === "list" ? () => <View style={{ height: 8 }} /> : undefined}
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await refreshOps(section);
                setRefreshing(false);
              }}
              ListEmptyComponent={
                <Text style={[styles.empty, { color: p.tabIconDefault }]}>{emptyCopy}</Text>
              }
              renderItem={viewMode === "grid" ? renderOpsGrid : renderOpsList}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  driveRowLayout: { flex: 1, flexDirection: "row" },
  sidebar: { paddingTop: 12, paddingBottom: 20 },
  sidebarBrand: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: TacticalPalette.boneMuted,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  sideItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginHorizontal: 4,
    borderRadius: 8,
    marginBottom: 4,
  },
  mainCol: { flex: 1, paddingHorizontal: 16, paddingTop: 12, alignSelf: "stretch", width: "100%" },
  breadcrumb: { fontSize: 12, fontWeight: "600", marginBottom: 10, letterSpacing: 0.2 },
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
  },
  gridTitle: { fontSize: 14, fontWeight: "700", width: "100%" },
  gridSub: { fontSize: 13, fontWeight: "800", marginTop: 4, letterSpacing: 0.5 },
  gridMeta: { fontSize: 11, marginTop: 12, fontWeight: "500" },
  empty: { fontSize: 13, lineHeight: 20, marginTop: 24, paddingHorizontal: 4 },
});
