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
  View,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Card, FAB, IconButton, List, Searchbar } from "react-native-paper";

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

/** MaterialCommunityIcons name for Paper `List.Icon`. */
function mciForExt(ext: string): string {
  if (["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(ext)) return "file-image-outline";
  if (["pdf"].includes(ext)) return "file-pdf-box";
  if (["zip", "rar", "7z", "gz"].includes(ext)) return "zip-box-outline";
  if (["mp4", "mov", "webm", "mkv"].includes(ext)) return "filmstrip-box";
  if (["mp3", "wav", "ogg", "m4a"].includes(ext)) return "music-box-outline";
  if (["txt", "md", "log"].includes(ext)) return "file-document-outline";
  if (["js", "ts", "tsx", "json", "py", "rb", "go", "rs", "c", "h"].includes(ext)) return "code-tags";
  return "file-outline";
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
  const [fabOpen, setFabOpen] = useState(false);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return objects;
    return objects.filter((o) => o.name.toLowerCase().includes(q));
  }, [objects, search]);

  const [thumbUrlByKey, setThumbUrlByKey] = useState<Record<string, string>>({});
  const actionSheetRef = useRef<BottomSheetModal>(null);
  const [actionItem, setActionItem] = useState<VaultS3ListObject | null>(null);
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
      setFabOpen(false);
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
      const desc = `${formatBytes(item.size)}${item.lastModified ? ` · ${item.lastModified.toLocaleString()}` : ""}`;
      return (
        <Card mode="elevated" style={styles.listCard}>
          <List.Item
            title={item.name}
            description={desc}
            titleNumberOfLines={2}
            descriptionNumberOfLines={2}
            onPress={() => void openOrShare(item)}
            left={() =>
              thumb ? (
                <Image source={{ uri: thumb }} style={styles.listThumb} />
              ) : (
                <List.Icon icon={mciForExt(ext)} />
              )
            }
            right={() => <IconButton icon="dots-vertical" onPress={() => openActionMenu(item)} />}
          />
        </Card>
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
        <Card mode="elevated" style={styles.gridCard} onPress={() => void openOrShare(item)}>
          <View style={styles.gridInner}>
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
            <IconButton
              style={styles.gridDots}
              size={20}
              icon="dots-vertical"
              onPress={() => openActionMenu(item)}
            />
          </View>
        </Card>
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
        <Searchbar
          placeholder="Search files…"
          value={search}
          onChangeText={setSearch}
          style={styles.searchbar}
          inputStyle={styles.searchInput}
          iconColor={TacticalPalette.boneMuted}
          placeholderTextColor={TacticalPalette.boneMuted}
          elevation={0}
        />
        <View style={styles.headerActions}>
          <Pressable onPress={() => void refetch()} style={styles.headerPressBtn} hitSlop={6}>
            {isFetching ? (
              <ActivityIndicator size="small" color={TacticalPalette.coyote} />
            ) : (
              <FontAwesome name="refresh" size={16} color={TacticalPalette.coyote} />
            )}
          </Pressable>
          <IconButton
            icon="format-list-bulleted"
            iconColor={TacticalPalette.bone}
            containerColor={viewMode === "list" ? TacticalPalette.oliveDrab : undefined}
            style={styles.iconBtn}
            onPress={() => void setVaultDriveViewMode("list")}
          />
          <IconButton
            icon="view-grid-outline"
            iconColor={TacticalPalette.bone}
            containerColor={viewMode === "grid" ? TacticalPalette.oliveDrab : undefined}
            style={styles.iconBtn}
            onPress={() => void setVaultDriveViewMode("grid")}
          />
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
            <Text style={styles.empty}>{search.trim() ? "No matches." : "No files yet. Use + to upload."}</Text>
          }
          renderItem={viewMode === "grid" ? renderGrid : renderList}
          estimatedItemSize={viewMode === "grid" ? 168 : 88}
        />
      )}

      <FAB.Group
        open={fabOpen}
        visible
        icon={fabOpen ? "close" : "plus"}
        actions={[
          {
            icon: "file-upload-outline",
            label: "Upload document",
            onPress: () => void pickAndUpload("doc"),
          },
          {
            icon: "image-plus-outline",
            label: "Upload media",
            onPress: () => void pickAndUpload("media"),
          },
          {
            icon: "folder-plus-outline",
            label: "Create folder",
            onPress: () =>
              Alert.alert(
                "Not available yet",
                "Folder creation is not wired to S3 in this build. Use prefixes in a future update.",
              ),
          },
        ]}
        onStateChange={({ open }) => setFabOpen(open)}
        style={styles.fabGroup}
      />

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
  searchbar: {
    backgroundColor: TacticalPalette.charcoal,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    borderRadius: 10,
  },
  searchInput: { minHeight: 0, color: TacticalPalette.bone, fontSize: 15 },
  headerActions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  iconBtn: { margin: 0 },
  headerPressBtn: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    backgroundColor: TacticalPalette.charcoal,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  listCard: {
    backgroundColor: TacticalPalette.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
  },
  listThumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: TacticalPalette.charcoal, marginLeft: 8, alignSelf: "center" },
  gridRowWrap: { gap: 10, paddingHorizontal: 8, marginBottom: 10 },
  gridCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: TacticalPalette.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    overflow: "hidden",
  },
  gridInner: { paddingBottom: 8, position: "relative" },
  gridImage: { width: "100%", height: 110, backgroundColor: TacticalPalette.charcoal },
  gridIconArea: {
    height: 110,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: TacticalPalette.charcoal,
  },
  gridLabel: { color: TacticalPalette.bone, fontSize: 12, fontWeight: "600", paddingHorizontal: 8, marginTop: 6 },
  gridDots: { position: "absolute", top: 2, right: 2, margin: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  fabGroup: { position: "absolute", right: 0, bottom: 0 },
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
