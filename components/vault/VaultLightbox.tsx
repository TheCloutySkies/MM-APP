import FontAwesome from "@expo/vector-icons/FontAwesome";
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { TacticalPalette } from "@/constants/TacticalTheme";

/** Row shape needed for storage download (matches `VaultObjectRow` in the vault screen). */
export type VaultLightboxRow = {
  id: string;
  storage_path: string | null;
  created_at: string;
  folder_id: string | null;
  vault_metadata?: unknown;
};

export type VaultLightboxEntry = {
  id: string;
  row: VaultLightboxRow;
  title: string;
  mime: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  entries: VaultLightboxEntry[];
  initialIndex: number;
  loadDecrypted: (row: VaultLightboxRow) => Promise<{ bytes: Uint8Array; mime: string }>;
  onDelete?: (row: VaultLightboxRow) => void;
};

export function VaultLightbox({ visible, onClose, entries, initialIndex, loadDecrypted, onDelete }: Props) {
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const { width: winW, height: winH } = Dimensions.get("window");

  const safeEntries = entries.length ? entries : [];
  const active = safeEntries[index] ?? null;

  const revoke = useCallback(() => {
    if (urlRef.current) {
      try {
        URL.revokeObjectURL(urlRef.current);
      } catch {
        /* ignore */
      }
      urlRef.current = null;
    }
    setObjectUrl(null);
  }, []);

  useEffect(() => {
    if (!visible) {
      revoke();
      setError(null);
      setLoading(false);
      return;
    }
    setIndex(Math.min(Math.max(0, initialIndex), Math.max(0, safeEntries.length - 1)));
  }, [visible, initialIndex, safeEntries.length, revoke]);

  useEffect(() => {
    if (!visible || !active) return;
    let cancelled = false;
    revoke();
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const { bytes, mime } = await loadDecrypted(active.row);
        if (cancelled) return;
        const useMime =
          mime.startsWith("image/") || mime.includes("pdf") ? mime : active.mime || "application/octet-stream";
        const blob = new Blob([Uint8Array.from(bytes)], { type: useMime });
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setObjectUrl(url);
      } catch {
        if (!cancelled) {
          setError("Unable to unlock file. Check your connection.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, active?.id, active?.row, active?.mime, loadDecrypted, revoke]);

  useEffect(
    () => () => {
      revoke();
    },
    [revoke],
  );

  const canPrev = index > 0 && safeEntries.length > 1;
  const canNext = index < safeEntries.length - 1 && safeEntries.length > 1;
  const isImage = (active?.mime ?? "").toLowerCase().startsWith("image/");
  const isPdf =
    (active?.mime ?? "").toLowerCase().includes("pdf") || (active?.mime ?? "").includes("application/pdf");

  const goDownload = () => {
    if (!objectUrl || !active || Platform.OS !== "web") return;
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = active.title || "vault-file";
    a.rel = "noopener";
    a.click();
  };

  if (!visible) return null;

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.shell}>
        <View style={styles.topBar}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close">
            <FontAwesome name="times" size={22} color={TacticalPalette.bone} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {active?.title ?? ""}
          </Text>
          {Platform.OS === "web" && objectUrl ? (
            <Pressable onPress={goDownload} style={styles.dlBtn} accessibilityRole="button" accessibilityLabel="Download">
              <Text style={styles.dlBtnTx}>Download</Text>
            </Pressable>
          ) : (
            <View style={{ width: 92 }} />
          )}
        </View>

        {safeEntries.length > 1 && isImage ? (
          <View style={styles.pagerHint}>
            <Pressable
              disabled={!canPrev}
              onPress={() => canPrev && setIndex((i) => Math.max(0, i - 1))}
              style={[styles.pagerArrow, { opacity: canPrev ? 1 : 0.35 }]}>
              <FontAwesome name="chevron-left" size={22} color={TacticalPalette.bone} />
            </Pressable>
            <Text style={styles.pagerCount}>
              {index + 1} / {safeEntries.length}
            </Text>
            <Pressable
              disabled={!canNext}
              onPress={() => canNext && setIndex((i) => Math.min(safeEntries.length - 1, i + 1))}
              style={[styles.pagerArrow, { opacity: canNext ? 1 : 0.35 }]}>
              <FontAwesome name="chevron-right" size={22} color={TacticalPalette.bone} />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.body}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={TacticalPalette.accent} />
              <Text style={styles.loadHint}>Opening…</Text>
            </View>
          ) : null}
          {error ? (
            <View style={styles.center}>
              <FontAwesome name="exclamation-circle" size={36} color={TacticalPalette.coyote} />
              <Text style={styles.errTx}>{error}</Text>
            </View>
          ) : null}
          {!loading && !error && objectUrl && isImage ? (
            <Image
              source={{ uri: objectUrl }}
              style={{ width: winW, height: Math.max(320, winH * 0.72), maxWidth: "100%" }}
              resizeMode="contain"
              accessibilityLabel="Vault photo"
            />
          ) : null}
          {!loading && !error && objectUrl && isPdf && Platform.OS === "web"
            ? createElement("iframe", {
                title: active?.title ?? "PDF",
                src: objectUrl,
                style: { flex: 1, width: "100%", height: "100%", border: "none", minHeight: Math.round(winH * 0.72) },
              })
            : null}
          {!loading && !error && objectUrl && isPdf && Platform.OS !== "web" ? (
            <Text style={styles.errTx}>PDF preview works best in the browser.</Text>
          ) : null}
        </View>

        {active && onDelete ? (
          <View style={styles.bottomBar}>
            <Pressable
              onPress={() => {
                onDelete(active.row);
                onClose();
              }}
              style={styles.delBtn}>
              <Text style={styles.delBtnTx}>Delete from Vault</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: TacticalPalette.matteBlack,
    paddingTop: Platform.OS === "web" ? 12 : 48,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TacticalPalette.border,
  },
  iconBtn: { padding: 6 },
  title: { flex: 1, color: TacticalPalette.bone, fontWeight: "900", fontSize: 16 },
  dlBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: TacticalPalette.accentDim,
  },
  dlBtnTx: { color: TacticalPalette.bone, fontWeight: "800", fontSize: 13 },
  pagerHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    paddingVertical: 10,
  },
  pagerArrow: { padding: 10 },
  pagerCount: { color: TacticalPalette.boneMuted, fontWeight: "800", fontSize: 13 },
  body: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 8 },
  center: { alignItems: "center", gap: 12, padding: 24 },
  loadHint: { color: TacticalPalette.boneMuted, fontWeight: "700" },
  errTx: { color: TacticalPalette.bone, textAlign: "center", lineHeight: 22, fontSize: 15, marginTop: 8 },
  bottomBar: { padding: 16, alignItems: "center" },
  delBtn: { paddingVertical: 12, paddingHorizontal: 18 },
  delBtnTx: { color: "#e07070", fontWeight: "800", fontSize: 15 },
});
