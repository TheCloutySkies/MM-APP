import FontAwesome from "@expo/vector-icons/FontAwesome";
import { BottomSheetBackdrop, BottomSheetModal } from "@gorhom/bottom-sheet";
import * as DocumentPicker from "expo-document-picker";
import { cacheDirectory, writeAsStringAsync, EncodingType } from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { useCallback, useMemo, useRef, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { FlashList } from "@shopify/flash-list";

import { TacticalPalette } from "@/constants/TacticalTheme";
import { useVaultS3Objects, useInvalidateVaultS3 } from "@/hooks/useVaultS3Objects";
import {
  getVaultObjectBlob,
  getVaultPresignedGetUrl,
  isVaultS3StorageConfigured,
  putVaultObject,
  removeVaultObjectKeys,
  type VaultS3ListObject,
} from "@/lib/storage";
import { useMMStore } from "@/store/mmStore";

const AnyFlashList: any = FlashList;

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function fileIcon(ext: string): ComponentProps<typeof FontAwesome>["name"] {
  if (["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(ext)) return "file-image-o";
  if (["pdf"].includes(ext)) return "file-pdf-o";
  if (["zip", "rar", "7z", "gz"].includes(ext)) return "file-archive-o";
  if (["mp4", "mov", "webm", "mkv"].includes(ext)) return "file-video-o";
  if (["mp3", "wav", "ogg", "m4a"].includes(ext)) return "file-audio-o";
  if (["txt", "md", "log"].includes(ext)) return "file-text-o";
  if (["js", "ts", "tsx", "json", "py", "rb", "go", "rs", "c", "h"].includes(ext)) return "file-code-o";
  return "file-o";
}

function isImageName(name: string): boolean {
  return ["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(extOf(name));
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]!);
  return btoa(s);
}

export function S3MinioDrive() {
  const profileId = useMMStore((s) => s.profileId);
  const supabase = useMMStore((s) => s.supabase);
  const viewMode = useMMStore((s) => s.vaultDriveViewMode);
  const setVaultDriveViewMode = useMMStore((s) => s.setVaultDriveViewMode);

  const { data: objects = [], isLoading, isFetching, error, refetch } = useVaultS3Objects(profileId);
  const invalidate = useInvalidateVaultS3();

  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return objects;
    return objects.filter((o) => o.name.toLowerCase().includes(q));
  }, [objects, search]);

  const [thumbUrlByKey, setThumbUrlByKey] = useState<Record<string, string>>({});
  const fabSheetRef = useRef<BottomSheetModal>(null);
  const actionSheetRef = useRef<BottomSheetModal>(null);
  const [actionItem, setActionItem] = useState<VaultS3ListObject | null>(null);
  const snapFab = useMemo(() => ["32%"], []);
  const snapAct = useMemo(() => ["38%"], []);

  const loadThumb = useCallback(
    async (item: VaultS3ListObject) => {
      if (!isImageName(item.name) || thumbUrlByKey[item.key]) return;
      const { url, error: e } = await getVaultPresignedGetUrl(item.key, 900);
      if (url && !e) setThumbUrlByKey((p) => ({ ...p, [item.key]: url }));
    },
    [thumbUrlByKey],
  );

  const openOrShare = useCallback(
    async (item: VaultS3ListObject) => {
      if (!supabase) {
        Alert.alert("Session", "Sign in again.");
        return;
      }
      const { data: blob, error: dErr } = await getVaultObjectBlob(supabase, item.key);
      if (dErr || !blob) {
        Alert.alert("Download failed", dErr?.message ?? "Unknown error");
        return;
      }
      const safeName = item.name.split("/").pop() ?? "file";
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = safeName;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      try {
        const b64 = await blobToBase64(blob);
        const path = `${cacheDirectory ?? ""}mm-${safeName}`;
        await writeAsStringAsync(path, b64, { encoding: EncodingType.Base64 });
        const can = await Sharing.isAvailableAsync();
        if (can) await Sharing.shareAsync(path, { mimeType: blob.type || undefined, dialogTitle: safeName });
        else Alert.alert("Saved", path);
      } catch (e) {
        Alert.alert("Open failed", e instanceof Error ? e.message : "Unknown");
      }
    },
    [supabase],
  );

  const onDelete = useCallback(
    (item: VaultS3ListObject) => {
      if (!supabase) return;
      Alert.alert("Delete file?", item.name, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const { error: rErr } = await removeVaultObjectKeys(supabase, [item.key]);
              if (rErr) Alert.alert("Delete failed", rErr.message);
              else invalidate(profileId);
            })();
          },
        },
      ]);
    },
    [supabase, invalidate, profileId],
  );

  const pickAndUpload = useCallback(
    async (mode: "doc" | "media") => {
      fabSheetRef.current?.dismiss();
      if (!profileId || !supabase) return;
      try {
        if (mode === "media") {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) {
            Alert.alert("Permission", "Photo library access is required.");
            return;
          }
          const res = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.All,
            quality: 0.92,
          });
          if (res.canceled || !res.assets?.[0]) return;
          const a = res.assets[0];
          const uri = a.uri;
          const mime = a.mimeType ?? "application/octet-stream";
          const base = a.fileName ?? `photo-${Date.now()}.jpg`;
          const r = await fetch(uri);
          const buf = new Uint8Array(await r.arrayBuffer());
          const key = `${profileId}/drive/${Date.now()}-${base.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
          const { error: upErr } = await putVaultObject(supabase, profileId, key, buf, {
            contentType: mime,
            upsert: true,
          });
          if (upErr) Alert.alert("Upload failed", upErr.message);
          else invalidate(profileId);
          return;
        }
        const doc = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
        if (doc.canceled || !doc.assets?.[0]) return;
        const a = doc.assets[0];
        const r = await fetch(a.uri);
        const buf = new Uint8Array(await r.arrayBuffer());
        const base = a.name ?? "upload";
        const mime = a.mimeType ?? "application/octet-stream";
        const key = `${profileId}/drive/${Date.now()}-${base.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
        const { error: upErr } = await putVaultObject(supabase, profileId, key, buf, {
          contentType: mime,
          upsert: true,
        });
        if (upErr) Alert.alert("Upload failed", upErr.message);
        else invalidate(profileId);
      } catch (e) {
        Alert.alert("Upload", e instanceof Error ? e.message : "Failed");
      }
    },
    [profileId, supabase, invalidate],
  );

  const openActionMenu = useCallback((item: VaultS3ListObject) => {
    setActionItem(item);
    actionSheetRef.current?.present();
  }, []);

  const renderList = useCallback(
    ({ item }: { item: VaultS3ListObject }) => {
      void loadThumb(item);
      const ext = extOf(item.name);
      const thumb = thumbUrlByKey[item.key];
      return (
        <Pressable
          onPress={() => void openOrShare(item)}
          style={({ pressed }) => [styles.listRow, pressed && { opacity: 0.92 }]}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.listThumb} />
          ) : (
            <View style={styles.listIconBox}>
              <FontAwesome name={fileIcon(ext)} size={22} color={TacticalPalette.boneMuted} />
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.listName} numberOfLines={2}>
              {item.name}
            </Text>
            <Text style={styles.listMeta}>
              {formatBytes(item.size)}
              {item.lastModified ? ` · ${item.lastModified.toLocaleString()}` : ""}
            </Text>
          </View>
          <Pressable onPress={() => openActionMenu(item)} hitSlop={12} style={styles.dotBtn}>
            <FontAwesome name="ellipsis-v" size={18} color={TacticalPalette.boneMuted} />
          </Pressable>
        </Pressable>
      );
    },
    [loadThumb, thumbUrlByKey, openOrShare, openActionMenu],
  );

  const renderGrid = useCallback(
    ({ item }: { item: VaultS3ListObject }) => {
      void loadThumb(item);
      const ext = extOf(item.name);
      const thumb = thumbUrlByKey[item.key];
      return (
        <Pressable
          onPress={() => void openOrShare(item)}
          style={({ pressed }) => [styles.gridTile, pressed && { opacity: 0.92 }]}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.gridImage} />
          ) : (
            <View style={styles.gridIconArea}>
              <FontAwesome name={fileIcon(ext)} size={36} color={TacticalPalette.boneMuted} />
            </View>
          )}
          <Text style={styles.gridLabel} numberOfLines={2}>
            {item.name}
          </Text>
          <Pressable style={styles.gridDots} onPress={() => openActionMenu(item)} hitSlop={8}>
            <FontAwesome name="ellipsis-v" size={14} color={TacticalPalette.boneMuted} />
          </Pressable>
        </Pressable>
      );
    },
    [loadThumb, thumbUrlByKey, openOrShare, openActionMenu],
  );

  if (!isVaultS3StorageConfigured()) {
    return (
      <View style={styles.center}>
        <Text style={styles.warn}>MinIO is not configured. Set EXPO_PUBLIC_S3_* in your environment.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>My Vault</Text>
        <View style={styles.searchRow}>
          <FontAwesome name="search" size={14} color={TacticalPalette.boneMuted} style={{ marginRight: 8 }} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search files…"
            placeholderTextColor={TacticalPalette.boneMuted}
            style={styles.searchInput}
          />
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={() => void refetch()} style={styles.iconBtn}>
            {isFetching ? (
              <ActivityIndicator size="small" color={TacticalPalette.coyote} />
            ) : (
              <FontAwesome name="refresh" size={16} color={TacticalPalette.coyote} />
            )}
          </Pressable>
          <Pressable
            onPress={() => void setVaultDriveViewMode("list")}
            style={[styles.iconBtn, viewMode === "list" && styles.iconBtnOn]}>
            <FontAwesome name="list" size={16} color={TacticalPalette.bone} />
          </Pressable>
          <Pressable
            onPress={() => void setVaultDriveViewMode("grid")}
            style={[styles.iconBtn, viewMode === "grid" && styles.iconBtnOn]}>
            <FontAwesome name="th-large" size={16} color={TacticalPalette.bone} />
          </Pressable>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.skeleton}>
          <ActivityIndicator size="large" color={TacticalPalette.coyote} />
          <Text style={styles.skeletonTx}>Loading your files…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.err}>{error instanceof Error ? error.message : "Failed to load"}</Text>
          <Pressable onPress={() => void refetch()} style={styles.retryBtn}>
            <Text style={styles.retryTx}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <AnyFlashList
          style={{ flex: 1 }}
          data={filtered}
          keyExtractor={(i: VaultS3ListObject) => i.key}
          numColumns={viewMode === "grid" ? 2 : 1}
          extraData={`${viewMode}-${Object.keys(thumbUrlByKey).length}`}
          columnWrapperStyle={viewMode === "grid" ? styles.gridRowWrap : undefined}
          ItemSeparatorComponent={viewMode === "list" ? () => <View style={{ height: 8 }} /> : undefined}
          ListEmptyComponent={
            <Text style={styles.empty}>{search.trim() ? "No matches." : "No files yet. Tap + to upload."}</Text>
          }
          renderItem={viewMode === "grid" ? renderGrid : renderList}
          estimatedItemSize={viewMode === "grid" ? 168 : 88}
        />
      )}

      <Pressable style={styles.fab} onPress={() => fabSheetRef.current?.present()} accessibilityRole="button">
        <FontAwesome name="plus" size={26} color={TacticalPalette.matteBlack} />
      </Pressable>

      <BottomSheetModal
        ref={fabSheetRef}
        snapPoints={snapFab}
        enablePanDownToClose
        backdropComponent={(p) => <BottomSheetBackdrop {...p} appearsOnIndex={0} disappearsOnIndex={-1} />}
        enableDynamicSizing={false}
        // @ts-expect-error Fabric / New Architecture guardrail (prop may be untyped by version)
        disableFullWindowOverlay={Platform.OS === "ios"}>
        <View style={styles.sheetInner}>
          <Text style={styles.sheetTitle}>Upload</Text>
          <Pressable style={styles.sheetRow} onPress={() => void pickAndUpload("doc")}>
            <FontAwesome name="file-o" size={18} color={TacticalPalette.bone} />
            <Text style={styles.sheetRowTx}>Upload document</Text>
          </Pressable>
          <Pressable style={styles.sheetRow} onPress={() => void pickAndUpload("media")}>
            <FontAwesome name="image" size={18} color={TacticalPalette.bone} />
            <Text style={styles.sheetRowTx}>Upload media</Text>
          </Pressable>
        </View>
      </BottomSheetModal>

      <BottomSheetModal
        ref={actionSheetRef}
        snapPoints={snapAct}
        enablePanDownToClose
        backdropComponent={(p) => <BottomSheetBackdrop {...p} appearsOnIndex={0} disappearsOnIndex={-1} />}
        enableDynamicSizing={false}
        // @ts-expect-error Fabric / New Architecture guardrail (prop may be untyped by version)
        disableFullWindowOverlay={Platform.OS === "ios"}
        onDismiss={() => setActionItem(null)}>
        <View style={styles.sheetInner}>
          <Text style={styles.sheetTitle} numberOfLines={1}>
            {actionItem?.name ?? "File"}
          </Text>
          <Pressable
            style={styles.sheetRow}
            onPress={() => {
              actionSheetRef.current?.dismiss();
              if (actionItem) void openOrShare(actionItem);
            }}>
            <FontAwesome name="download" size={18} color={TacticalPalette.bone} />
            <Text style={styles.sheetRowTx}>View / download</Text>
          </Pressable>
          <Pressable
            style={styles.sheetRow}
            onPress={() => {
              actionSheetRef.current?.dismiss();
              if (actionItem) void openOrShare(actionItem);
            }}>
            <FontAwesome name="share-alt" size={18} color={TacticalPalette.bone} />
            <Text style={styles.sheetRowTx}>Share</Text>
          </Pressable>
          <Pressable
            style={styles.sheetRowDanger}
            onPress={() => {
              const it = actionItem;
              actionSheetRef.current?.dismiss();
              if (it) onDelete(it);
            }}>
            <FontAwesome name="trash" size={18} color={TacticalPalette.danger} />
            <Text style={[styles.sheetRowTx, { color: TacticalPalette.danger }]}>Delete</Text>
          </Pressable>
        </View>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: TacticalPalette.matteBlack },
  header: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TacticalPalette.border,
    gap: 10,
  },
  title: { color: TacticalPalette.bone, fontWeight: "900", fontSize: 20, marginTop: 4 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    backgroundColor: TacticalPalette.charcoal,
  },
  searchInput: { flex: 1, color: TacticalPalette.bone, paddingVertical: 10, fontSize: 15 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBtn: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    backgroundColor: TacticalPalette.charcoal,
  },
  iconBtnOn: { borderColor: TacticalPalette.coyote, backgroundColor: "rgba(139,90,60,0.2)" },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: TacticalPalette.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
  },
  listThumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: TacticalPalette.charcoal },
  listIconBox: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: TacticalPalette.charcoal,
    alignItems: "center",
    justifyContent: "center",
  },
  listName: { color: TacticalPalette.bone, fontWeight: "700", fontSize: 15 },
  listMeta: { color: TacticalPalette.boneMuted, fontSize: 12, marginTop: 4 },
  dotBtn: { padding: 8 },
  gridRowWrap: { gap: 10, paddingHorizontal: 8, marginBottom: 10 },
  gridTile: {
    flex: 1,
    minWidth: 0,
    backgroundColor: TacticalPalette.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    overflow: "hidden",
    paddingBottom: 8,
  },
  gridImage: { width: "100%", height: 110, backgroundColor: TacticalPalette.charcoal },
  gridIconArea: {
    height: 110,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: TacticalPalette.charcoal,
  },
  gridLabel: { color: TacticalPalette.bone, fontSize: 12, fontWeight: "600", paddingHorizontal: 8, marginTop: 6 },
  gridDots: { position: "absolute", top: 6, right: 6, padding: 6, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 6 },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: TacticalPalette.accent,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    ...(Platform.OS === "web" ? { boxShadow: "0 4px 14px rgba(0,0,0,0.35)" } : {}),
  },
  sheetInner: { paddingHorizontal: 20, paddingBottom: 24, gap: 4 },
  sheetTitle: { color: TacticalPalette.bone, fontWeight: "900", fontSize: 16, marginBottom: 8 },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TacticalPalette.border,
  },
  sheetRowDanger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    marginTop: 4,
  },
  sheetRowTx: { color: TacticalPalette.bone, fontSize: 16, fontWeight: "600" },
  center: { flex: 1, justifyContent: "center", padding: 24 },
  warn: { color: TacticalPalette.boneMuted, textAlign: "center", lineHeight: 22 },
  err: { color: TacticalPalette.danger, textAlign: "center", marginBottom: 12 },
  retryBtn: { alignSelf: "center", paddingVertical: 12, paddingHorizontal: 20, backgroundColor: TacticalPalette.accent, borderRadius: 10 },
  retryTx: { color: TacticalPalette.matteBlack, fontWeight: "800" },
  skeleton: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  skeletonTx: { color: TacticalPalette.boneMuted, fontWeight: "600" },
  empty: { color: TacticalPalette.boneMuted, textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
});
