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
} from "react-native";

import Colors from "@/constants/Colors";
import { aes256GcmDecrypt, aes256GcmEncrypt, decryptUtf8, type AeadBundle } from "@/lib/crypto/aesGcm";
import { utf8, utf8decode } from "@/lib/crypto/bytes";
import { runCloutVisionPipeline } from "@/lib/media/cloutVision";
import {
  OPS_AAD,
  formatAarForDisplay,
  formatMissionForDisplay,
  formatSitrepForDisplay,
  previewOpsRow,
  type AarPayloadV1,
  type MissionPlanPayloadV1,
  type OpsDocKind,
  type SitrepPayloadV1,
} from "@/lib/opsReports";
import {
  formatOpsVaultHeadline,
  formatVaultListDate,
  vaultItemDisplayName,
} from "@/lib/vaultNaming";
import { resolveMapEncryptKey, useMMStore } from "@/store/mmStore";

type VaultObjectRow = { id: string; storage_path: string; created_at: string };

type OpsReportRow = {
  id: string;
  encrypted_payload: string;
  created_at: string;
  doc_kind: OpsDocKind;
  author_username: string;
};

type VaultSection = "private" | OpsDocKind;

type ViewMode = "list" | "grid";

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
  const [opsRows, setOpsRows] = useState<OpsReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const prefix = vaultMode ?? "main";

  const refreshPrivate = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("vault_objects")
      .select("id, storage_path, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      Alert.alert("Vault list", error.message);
      return;
    }
    setRows((data ?? []) as VaultObjectRow[]);
  }, [supabase]);

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
      } else {
        body = formatAarForDisplay(JSON.parse(json) as AarPayloadV1);
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
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((r) => {
      const disp = vaultItemDisplayName(r.storage_path);
      const hay = `${disp.title} ${disp.subtitle ?? ""} ${r.storage_path}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, prefix, query]);

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

  const borderM = scheme === "dark" ? "#27272a" : "#e4e4e7";
  const surface = scheme === "dark" ? "#0a0a0b" : "#fafafa";

  const sectionChip = (id: VaultSection, label: string) => {
    const active = section === id;
    return (
      <Pressable
        key={id}
        onPress={() => {
          setSection(id);
          if (id === "private") void refreshPrivate();
          else void refreshOps(id);
        }}
        style={[
          styles.segChip,
          {
            borderColor: active ? p.tint : borderM,
            backgroundColor: active ? (scheme === "dark" ? "#1e293b" : "#eff6ff") : surface,
          },
        ]}>
        <FontAwesome
          name={sectionIcon(id)}
          size={15}
          color={active ? p.tint : p.tabIconDefault}
          style={{ marginRight: 8 }}
        />
        <Text style={{ color: p.text, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>
          {label}
        </Text>
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
            backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : surface,
          },
        ]}>
        <View style={[styles.iconBubble, { backgroundColor: scheme === "dark" ? "#1e293b" : "#e0f2fe" }]}>
          <FontAwesome name="lock" size={20} color={p.tint} />
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
            backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : surface,
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
      item.doc_kind === "mission_plan" ? "map-marker" : item.doc_kind === "sitrep" ? "bullhorn" : "history";
    return (
      <Pressable
        onPress={() => openOpsRow(item)}
        style={({ pressed }) => [
          styles.driveRow,
          {
            borderColor: borderM,
            backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : surface,
          },
        ]}>
        <View style={[styles.iconBubble, { backgroundColor: scheme === "dark" ? "#1e293b" : "#e0f2fe" }]}>
          <FontAwesome name={icon} size={20} color={p.tint} />
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
      item.doc_kind === "mission_plan" ? "map-marker" : item.doc_kind === "sitrep" ? "bullhorn" : "history";
    return (
      <Pressable
        onPress={() => openOpsRow(item)}
        style={({ pressed }) => [
          styles.gridCell,
          {
            borderColor: borderM,
            backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : surface,
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

  return (
    <View style={[styles.wrap, { backgroundColor: p.background }]}>
      <Text style={[styles.breadcrumb, { color: p.tabIconDefault }]}>
        Vault · {(vaultMode ?? "main").toUpperCase()} · {sectionTitle(section)}
        {loading ? " · …" : ""}
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segRow}>
        {sectionChip("private", "My drive")}
        {sectionChip("mission_plan", "Missions")}
        {sectionChip("sitrep", "SITREPs")}
        {sectionChip("aar", "AARs")}
      </ScrollView>

      <View style={[styles.searchBar, { borderColor: borderM, backgroundColor: surface }]}>
        <FontAwesome name="search" size={16} color={p.tabIconDefault} style={{ marginRight: 10 }} />
        <TextInput
          placeholder="Search in this folder"
          placeholderTextColor="#888"
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

      <View style={styles.toolbar}>
        <View style={styles.viewToggle}>
          <Pressable
            onPress={() => setViewMode("list")}
            style={[
              styles.viewBtn,
              viewMode === "list" && { backgroundColor: scheme === "dark" ? "#27272a" : "#e4e4e7" },
            ]}>
            <FontAwesome name="list" size={16} color={p.text} />
          </Pressable>
          <Pressable
            onPress={() => setViewMode("grid")}
            style={[
              styles.viewBtn,
              viewMode === "grid" && { backgroundColor: scheme === "dark" ? "#27272a" : "#e4e4e7" },
            ]}>
            <FontAwesome name="th-large" size={16} color={p.text} />
          </Pressable>
        </View>
        {section === "private" ? (
          <View style={styles.uploadSplit}>
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
          </View>
        ) : (
          <Text style={[styles.teamHint, { color: p.tabIconDefault }]}>Team folder · shared decrypt key</Text>
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
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  breadcrumb: { fontSize: 12, fontWeight: "600", marginBottom: 10, letterSpacing: 0.2 },
  segRow: { flexDirection: "row", gap: 8, paddingBottom: 12, alignItems: "center" },
  segChip: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
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
