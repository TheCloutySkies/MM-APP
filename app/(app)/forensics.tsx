import FontAwesome from "@expo/vector-icons/FontAwesome";
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Platform,
    Pressable,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    View,
    useColorScheme,
} from "react-native";

import Colors from "@/constants/Colors";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { buildForensicsReport, scrubMediaBytes, type ForensicsReport } from "@/lib/forensics/report";

export default function ForensicsScreen() {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ForensicsReport | null>(null);
  const [lastBytes, setLastBytes] = useState<Uint8Array | null>(null);
  const [lastMime, setLastMime] = useState<string | undefined>(undefined);

  const analyze = useCallback(async () => {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const asset = r.assets[0];
    setBusy(true);
    try {
      const res = await fetch(asset.uri);
      const buf = new Uint8Array(await res.arrayBuffer());
      setLastBytes(buf);
      setLastMime(asset.mimeType ?? undefined);
      const rep = await buildForensicsReport(buf, asset.name ?? "file", asset.mimeType ?? undefined);
      setReport(rep);
    } catch (e) {
      Alert.alert("Forensics", e instanceof Error ? e.message : "Failed to read file");
    } finally {
      setBusy(false);
    }
  }, []);

  const scrubAndShare = useCallback(async () => {
    if (!lastBytes || !report) return;
    setBusy(true);
    try {
      const cleaned = scrubMediaBytes(lastBytes, lastMime);
      const name = `scrubbed-${report.fileName}`;
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const blob = new Blob([cleaned as BlobPart], { type: report.mimeGuess });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
        Alert.alert("Scrub", "Download started (metadata-stripped copy).");
      } else {
        await Share.share({
          title: name,
          message: `Scrubbed ${cleaned.length} bytes. Save via your share target.`,
        });
      }
    } catch (e) {
      Alert.alert("Scrub", e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }, [lastBytes, lastMime, report]);

  const exportJson = useCallback(async () => {
    if (!report) return;
    const json = JSON.stringify(report, null, 2);
    const name = `forensics-${report.fileName.replace(/[^\w.\-]+/g, "_").slice(0, 40)}.json`;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    await Share.share({ title: name, message: json.length < 95000 ? json : `${json.slice(0, 90000)}\n… [truncated]` });
  }, [report]);

  return (
    <ScrollView style={[styles.wrap, { backgroundColor: p.background }]} contentContainerStyle={styles.content}>
      <Text style={[styles.lead, { color: p.tabIconDefault }]}>
        Client-side integrity and structure review: hashing, entropy, magic-byte containers, PNG/GIF/BMP dimensions,
        PDF version, ZIP heuristics, SQLite/GZIP/Mach-O/ELF detection, UTF-8 text preview, and JPEG EXIF/GPS presence
        (coordinates never shown). Nothing is uploaded. Desktop-grade OCR/CV is still out of scope in the browser.
      </Text>

      <Pressable
        onPress={() => void analyze()}
        disabled={busy}
        style={({ pressed }) => [
          styles.primaryBtn,
          { borderColor: TacticalPalette.accent, opacity: pressed ? 0.9 : busy ? 0.6 : 1 },
        ]}>
        {busy ? (
          <ActivityIndicator color={TacticalPalette.bone} />
        ) : (
          <>
            <FontAwesome name="folder-open" size={18} color={TacticalPalette.accent} style={{ marginRight: 10 }} />
            <Text style={styles.primaryBtnText}>Pick file to analyze</Text>
          </>
        )}
      </Pressable>

      {report ? (
        <View style={[styles.card, { borderColor: TacticalPalette.border }]}>
          <Text style={[styles.cardTitle, { color: p.text }]}>{report.fileName}</Text>
          <Text style={[styles.row, { color: p.tabIconDefault }]}>
            Size: {report.byteLength.toLocaleString()} bytes
          </Text>
          <Text style={[styles.row, { color: p.tabIconDefault }]}>
            Sniff: {report.magic} · MIME {report.mimeGuess}
          </Text>
          {report.declaredExtension ? (
            <Text style={[styles.row, { color: report.extensionMismatch ? TacticalPalette.accent : p.tabIconDefault }]}>
              Extension .{report.declaredExtension}
              {report.extensionMismatch ? " — does not match sniffed container (possible misdirection)" : " — matches"}
            </Text>
          ) : null}

          <Text style={[styles.section, { color: TacticalPalette.coyote }]}>Hashes</Text>
          <Text style={[styles.mono, { color: TacticalPalette.bone }]} selectable>
            SHA-256: {report.sha256Hex}
          </Text>
          <Text style={[styles.mono, { color: TacticalPalette.boneMuted, marginTop: 6 }]} selectable>
            SHA-512: {report.sha512Hex}
          </Text>

          <Text style={[styles.section, { color: TacticalPalette.coyote }]}>Content signals</Text>
          <Text style={[styles.row, { color: p.tabIconDefault }]}>
            Entropy: {report.shannonEntropyBits.toFixed(2)} bits/byte (high → compressed / encrypted / random)
          </Text>
          <Text style={[styles.row, { color: p.tabIconDefault }]}>
            UTF-8: {report.utf8Status} · printable ASCII: {(report.printableAsciiRatio * 100).toFixed(1)}% · control
            (sample): {(report.controlCharRatio * 100).toFixed(1)}%
          </Text>
          <Text style={[styles.mono, { color: TacticalPalette.boneMuted, marginTop: 6 }]} selectable>
            Head (hex): {report.hexHead}
          </Text>

          {report.imageSize ? (
            <Text style={[styles.row, { color: p.tabIconDefault }]}>
              Raster decode: {report.imageSize.width}×{report.imageSize.height}
            </Text>
          ) : null}
          {report.structuralImageSize ? (
            <Text style={[styles.row, { color: p.tabIconDefault }]}>
              Structure size: {report.structuralImageSize.width}×{report.structuralImageSize.height} (
              {report.structuralImageSize.source})
            </Text>
          ) : null}

          {report.structureHints.length > 0 ? (
            <>
              <Text style={[styles.section, { color: TacticalPalette.coyote }]}>Structure</Text>
              {report.structureHints.map((h, i) => (
                <Text key={i} style={[styles.row, { color: p.tabIconDefault }]}>
                  • {h}
                </Text>
              ))}
            </>
          ) : null}

          {report.pdfVersion ? (
            <Text style={[styles.row, { color: p.tabIconDefault }]}>PDF header version: {report.pdfVersion}</Text>
          ) : null}

          {report.pngChunkTypes && report.pngChunkTypes.length > 0 ? (
            <Text style={[styles.row, { color: p.tabIconDefault }]}>
              PNG chunk order: {report.pngChunkTypes.join(" → ")}
            </Text>
          ) : null}

          {report.lineCountEstimate != null ? (
            <Text style={[styles.row, { color: p.tabIconDefault }]}>Lines (UTF-8 text): ~{report.lineCountEstimate}</Text>
          ) : null}

          {report.textPreview ? (
            <>
              <Text style={[styles.section, { color: TacticalPalette.coyote }]}>Text preview</Text>
              <Text style={[styles.previewBox, { color: p.text, borderColor: TacticalPalette.border }]} selectable>
                {report.textPreview}
              </Text>
            </>
          ) : null}

          <Text style={[styles.section, { color: TacticalPalette.coyote }]}>EXIF / JPEG segments</Text>
          <Text style={[styles.row, { color: p.tabIconDefault }]}>
            EXIF present: {report.exifSummary.hasExif ? "yes" : "no"} · GPS tags:{" "}
            {report.exifSummary.hasGps ? "present (coordinates not shown)" : "none"}
          </Text>
          {report.exifSummary.segmentKeys.length ? (
            <Text style={[styles.row, { color: p.tabIconDefault }]}>
              Segments: {report.exifSummary.segmentKeys.join(", ")}
            </Text>
          ) : null}

          <View style={styles.btnRow}>
            <Pressable
              onPress={() => void scrubAndShare()}
              style={({ pressed }) => [
                styles.secondaryBtn,
                { borderColor: TacticalPalette.coyote, opacity: pressed ? 0.88 : 1 },
              ]}>
              <FontAwesome name="eraser" size={16} color={TacticalPalette.coyote} style={{ marginRight: 8 }} />
              <Text style={[styles.secondaryBtnText, { color: TacticalPalette.bone }]}>Scrub JPEG & export</Text>
            </Pressable>
            <Pressable
              onPress={() => void exportJson()}
              style={({ pressed }) => [
                styles.secondaryBtn,
                { borderColor: p.tint, opacity: pressed ? 0.88 : 1 },
              ]}>
              <FontAwesome name="download" size={16} color={p.tint} style={{ marginRight: 8 }} />
              <Text style={[styles.secondaryBtnText, { color: p.tint }]}>Export JSON</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, maxWidth: 720, alignSelf: "center", width: "100%" },
  lead: { fontSize: 14, lineHeight: 22, marginBottom: 20 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 18,
    backgroundColor: TacticalPalette.elevated,
    marginBottom: 20,
  },
  primaryBtnText: { color: TacticalPalette.bone, fontWeight: "700", fontSize: 16 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 16,
    backgroundColor: TacticalPalette.charcoal,
    gap: 6,
  },
  cardTitle: { fontSize: 18, fontWeight: "800", marginBottom: 8 },
  row: { fontSize: 14, lineHeight: 20 },
  mono: { fontSize: 11, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", marginTop: 4, lineHeight: 16 },
  section: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8, marginTop: 14, marginBottom: 4 },
  previewBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    lineHeight: 20,
    maxHeight: 220,
  },
  btnRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexGrow: 1,
    flexBasis: "45%",
  },
  secondaryBtnText: { fontWeight: "700", fontSize: 13 },
});
