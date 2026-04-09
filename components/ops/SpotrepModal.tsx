import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import Colors from "@/constants/Colors";
import { lngLatToMgrs } from "@/lib/geo/mgrsFormat";
import { encryptUtf8 } from "@/lib/crypto/aesGcm";
import {
  OPS_AAD,
  SPOTREP_ACTIVITY_CHOICES,
  formatZuluDtg,
  type SpotrepActivityId,
  type SpotrepPayloadV1,
} from "@/lib/opsReports";
import { useMMStore } from "@/store/mmStore";
import type { SupabaseClient } from "@supabase/supabase-js";

type Props = {
  visible: boolean;
  onClose: () => void;
  scheme: "light" | "dark";
  supabase: SupabaseClient | null;
  profileId: string | null;
  username: string | null;
  mapKey: Uint8Array | null;
  onSaved: () => void;
  operationId?: string | null;
};

const BIG_INPUT_MINH = 52;

export function SpotrepModal({
  visible,
  onClose,
  scheme,
  supabase,
  profileId,
  username,
  mapKey,
  onSaved,
  operationId = null,
}: Props) {
  const router = useRouter();
  const setMgrsPickHandler = useMMStore((s) => s.setMgrsPickHandler);
  const p = Colors[scheme];
  const [saluteSize, setSaluteSize] = useState("");
  const [saluteActivity, setSaluteActivity] = useState<SpotrepActivityId>("stationary");
  const [saluteLocation, setSaluteLocation] = useState("");
  const [saluteUnit, setSaluteUnit] = useState("");
  const [saluteTime, setSaluteTime] = useState(() => formatZuluDtg());
  const [saluteEquipment, setSaluteEquipment] = useState("");
  const [assessment, setAssessment] = useState("");
  const [busy, setBusy] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setSaluteTime(formatZuluDtg());
  }, [visible]);

  const activityLabel = useMemo(
    () => SPOTREP_ACTIVITY_CHOICES.find((c) => c.id === saluteActivity)?.label ?? "Activity",
    [saluteActivity],
  );

  const inputStyle = [
    styles.input,
    {
      color: p.text,
      borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8",
      backgroundColor: scheme === "dark" ? "#09090b" : "#fafafa",
    },
  ];

  const fillFromGps = async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert("SPOTREP", "Location permission is required for GPS MGRS.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const grid = lngLatToMgrs(pos.coords.latitude, pos.coords.longitude, 5);
      if (!grid) {
        Alert.alert("SPOT", "Could not compute MGRS from this position.");
        return;
      }
      setSaluteLocation(grid);
    } catch (e) {
      Alert.alert("SPOTREP", e instanceof Error ? e.message : "GPS read failed");
    }
  };

  const refineOnMap = () => {
    setMgrsPickHandler((grid) => {
      setSaluteLocation(grid);
      setMgrsPickHandler(null);
    });
    router.push("/(app)/map");
  };

  const save = async () => {
    if (!supabase || !profileId || !mapKey || mapKey.length !== 32) {
      Alert.alert("SPOTREP", "Operations encryption key not available.");
      return;
    }
    if (!assessment.trim()) {
      Alert.alert("SPOTREP", "Assessment is required.");
      return;
    }
    setBusy(true);
    try {
      const preparedBy = username?.trim() || "unknown";
      const payload: SpotrepPayloadV1 = {
        v: 1,
        kind: "spotrep",
        saluteSize: saluteSize.trim(),
        saluteActivity,
        saluteLocation: saluteLocation.trim(),
        saluteUnit: saluteUnit.trim(),
        saluteTime: saluteTime.trim(),
        saluteEquipment: saluteEquipment.trim(),
        assessment: assessment.trim(),
        createdAt: Date.now(),
      };
      const encrypted = encryptUtf8(mapKey, JSON.stringify(payload), OPS_AAD.spotrep);
      const { error } = await supabase.from("ops_reports").insert({
        author_id: profileId,
        author_username: preparedBy,
        doc_kind: "spotrep",
        encrypted_payload: encrypted,
        ...(operationId ? { operation_id: operationId } : {}),
      });
      if (error) throw new Error(error.message);
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert("SPOTREP", e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.wrap, { backgroundColor: p.background }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: p.text }]}>SPOTREP (SALUTE)</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[styles.close, { color: p.tint }]}>Close</Text>
          </Pressable>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <Text style={[styles.hint, { color: p.tabIconDefault }]}>
            Immediate observation / change reporting. Fields are grouped by SALUTE; payload is encrypted for the team
            key like other ops reports.
          </Text>

          <Text style={[styles.sectionKicker, { color: p.tint }]}>[S]IZE</Text>
          <TextInput
            placeholder="e.g. 3× technicians, 1× BMP"
            placeholderTextColor="#888"
            value={saluteSize}
            onChangeText={setSaluteSize}
            style={[inputStyle, styles.bigInput]}
          />

          <Text style={[styles.sectionKicker, { color: p.tint }]}>[A]CTIVITY</Text>
          <Pressable
            onPress={() => setActivityOpen((v) => !v)}
            style={[styles.selectBtn, { borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8", backgroundColor: scheme === "dark" ? "#09090b" : "#fafafa" }]}>
            <Text style={[styles.selectBtnTx, { color: p.text }]}>{activityLabel}</Text>
            <Text style={{ color: p.tint, fontWeight: "800" }}>{activityOpen ? "▲" : "▼"}</Text>
          </Pressable>
          {activityOpen ? (
            <View style={[styles.activityList, { borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8" }]}>
              {SPOTREP_ACTIVITY_CHOICES.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    setSaluteActivity(c.id);
                    setActivityOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.activityRow,
                    { backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent" },
                  ]}>
                  <Text style={{ color: p.text, fontSize: 16, fontWeight: saluteActivity === c.id ? "800" : "500" }}>{c.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Text style={[styles.sectionKicker, { color: p.tint }]}>[L]OCATION (MGRS)</Text>
          <TextInput
            placeholder="Grid or notes"
            placeholderTextColor="#888"
            value={saluteLocation}
            onChangeText={setSaluteLocation}
            style={[inputStyle, styles.bigInput]}
          />
          <View style={styles.inlineRow}>
            <Pressable
              onPress={() => void fillFromGps()}
              style={[styles.secondaryBtn, { borderColor: p.tint }]}>
              <Text style={[styles.secondaryTx, { color: p.tint }]}>GPS → MGRS</Text>
            </Pressable>
            <Pressable onPress={refineOnMap} style={[styles.secondaryBtn, { borderColor: p.tint }]}>
              <Text style={[styles.secondaryTx, { color: p.tint }]}>Refine on map</Text>
            </Pressable>
          </View>

          <Text style={[styles.sectionKicker, { color: p.tint }]}>[U]NIT / UNIFORM</Text>
          <TextInput
            placeholder="e.g. Green uniforms, standard gear"
            placeholderTextColor="#888"
            value={saluteUnit}
            onChangeText={setSaluteUnit}
            style={[inputStyle, styles.bigInput]}
          />

          <Text style={[styles.sectionKicker, { color: p.tint }]}>[T]IME (DTG)</Text>
          <TextInput placeholderTextColor="#888" value={saluteTime} onChangeText={setSaluteTime} style={[inputStyle, styles.bigInput]} />

          <Text style={[styles.sectionKicker, { color: p.tint }]}>[E]QUIPMENT</Text>
          <TextInput
            placeholder="e.g. HMG, small arms"
            placeholderTextColor="#888"
            value={saluteEquipment}
            onChangeText={setSaluteEquipment}
            style={[inputStyle, styles.bigInput]}
          />

          <Text style={[styles.sectionKicker, { color: p.tint }]}>ASSESSMENT</Text>
          <TextInput
            placeholder="Your interpretation (required)"
            placeholderTextColor="#888"
            value={assessment}
            onChangeText={setAssessment}
            style={[inputStyle, styles.tall]}
            multiline
          />

          <Pressable
            disabled={busy}
            onPress={() => void save()}
            style={[styles.saveBtn, { backgroundColor: p.tint, opacity: busy ? 0.7 : 1 }]}>
            <Text style={[styles.saveBtnText, { color: scheme === "dark" ? "#0f172a" : "#fff" }]}>
              {busy ? "Saving…" : "Save SPOTREP (team)"}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingTop: Platform.OS === "ios" ? 54 : 28 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  headerTitle: { fontSize: 20, fontWeight: "800" },
  close: { fontSize: 17, fontWeight: "700" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },
  hint: { fontSize: 12, lineHeight: 17, marginBottom: 10 },
  sectionKicker: { fontSize: 12, fontWeight: "900", letterSpacing: 0.8, marginTop: 14 },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16, marginBottom: 4 },
  bigInput: { minHeight: BIG_INPUT_MINH },
  tall: { minHeight: 96, textAlignVertical: "top" },
  selectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 14,
    marginBottom: 6,
  },
  selectBtnTx: { fontSize: 16, fontWeight: "700" },
  activityList: { borderWidth: 1, borderRadius: 12, overflow: "hidden", marginBottom: 8 },
  activityRow: { paddingVertical: 14, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#52525b33" },
  inlineRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 8, marginTop: 4 },
  secondaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 2,
  },
  secondaryTx: { fontWeight: "800", fontSize: 14 },
  saveBtn: { marginTop: 20, paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  saveBtnText: { fontSize: 16, fontWeight: "800" },
});
