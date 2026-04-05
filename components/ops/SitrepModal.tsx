import { useState } from "react";
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
import { encryptUtf8 } from "@/lib/crypto/aesGcm";
import { OPS_AAD, type SitrepPayloadV1 } from "@/lib/opsReports";
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
};

export function SitrepModal({
  visible,
  onClose,
  scheme,
  supabase,
  profileId,
  username,
  mapKey,
  onSaved,
}: Props) {
  const p = Colors[scheme];
  const [reportDatetime, setReportDatetime] = useState(() => new Date().toISOString().slice(0, 16));
  const [reportingUnit, setReportingUnit] = useState("");
  const [location, setLocation] = useState("");
  const [situationOverview, setSituationOverview] = useState("");
  const [enemyForcesActivity, setEnemyForcesActivity] = useState("");
  const [friendlyForcesStatus, setFriendlyForcesStatus] = useState("");
  const [sustainmentAdmin, setSustainmentAdmin] = useState("");
  const [personnelStatus, setPersonnelStatus] = useState("");
  const [equipmentStatus, setEquipmentStatus] = useState("");
  const [weather, setWeather] = useState("");
  const [commandersAssessment, setCommandersAssessment] = useState("");
  const [remarks, setRemarks] = useState("");
  const [classification, setClassification] = useState("UNCLASSIFIED");
  const [relatedMissionTitle, setRelatedMissionTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const inputStyle = [
    styles.input,
    {
      color: p.text,
      borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8",
      backgroundColor: scheme === "dark" ? "#09090b" : "#fafafa",
    },
  ];

  const save = async () => {
    if (!supabase || !profileId || !mapKey || mapKey.length !== 32) {
      Alert.alert("SITREP", "Operations encryption key not available.");
      return;
    }
    if (!situationOverview.trim()) {
      Alert.alert("SITREP", "Situation is required.");
      return;
    }
    setBusy(true);
    try {
      const preparedBy = username?.trim() || "unknown";
      const payload: SitrepPayloadV1 = {
        v: 1,
        kind: "sitrep",
        reportDatetime: reportDatetime.trim(),
        reportingUnit: reportingUnit.trim(),
        location: location.trim(),
        situationOverview: situationOverview.trim(),
        enemyForcesActivity: enemyForcesActivity.trim() || undefined,
        friendlyForcesStatus: friendlyForcesStatus.trim() || undefined,
        sustainmentAdmin: sustainmentAdmin.trim() || undefined,
        personnelStatus: personnelStatus.trim() || undefined,
        equipmentStatus: equipmentStatus.trim() || undefined,
        weather: weather.trim() || undefined,
        commandersAssessment: commandersAssessment.trim() || undefined,
        remarks: remarks.trim() || undefined,
        classification: classification.trim() || undefined,
        preparedBy,
        relatedMissionTitle: relatedMissionTitle.trim() || undefined,
      };
      const encrypted = encryptUtf8(mapKey, JSON.stringify(payload), OPS_AAD.sitrep);
      const { error } = await supabase.from("ops_reports").insert({
        author_id: profileId,
        author_username: preparedBy,
        doc_kind: "sitrep",
        encrypted_payload: encrypted,
      });
      if (error) throw new Error(error.message);
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert("SITREP", e instanceof Error ? e.message : "Save failed");
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
          <Text style={[styles.headerTitle, { color: p.text }]}>SITREP</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[styles.close, { color: p.tint }]}>Close</Text>
          </Pressable>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <Text style={[styles.hint, { color: p.tabIconDefault }]}>
            Situation report fields aligned with common tactical reporting (situation, enemy, friendly, sustainment, etc.).
            Saved encrypted for all authenticated members with the shared ops key.
          </Text>

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Classification</Text>
          <TextInput placeholderTextColor="#888" value={classification} onChangeText={setClassification} style={inputStyle} />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Report date / time</Text>
          <TextInput placeholderTextColor="#888" value={reportDatetime} onChangeText={setReportDatetime} style={inputStyle} />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Reporting unit</Text>
          <TextInput placeholderTextColor="#888" value={reportingUnit} onChangeText={setReportingUnit} style={inputStyle} />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Location</Text>
          <TextInput placeholderTextColor="#888" value={location} onChangeText={setLocation} style={inputStyle} />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Situation (overview)</Text>
          <TextInput
            placeholder="Current tactical picture"
            placeholderTextColor="#888"
            value={situationOverview}
            onChangeText={setSituationOverview}
            style={[inputStyle, styles.tall]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Enemy forces / activity</Text>
          <TextInput
            placeholderTextColor="#888"
            value={enemyForcesActivity}
            onChangeText={setEnemyForcesActivity}
            style={[inputStyle, styles.tall]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Friendly forces / status</Text>
          <TextInput
            placeholderTextColor="#888"
            value={friendlyForcesStatus}
            onChangeText={setFriendlyForcesStatus}
            style={[inputStyle, styles.tall]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Sustainment / admin</Text>
          <TextInput
            placeholderTextColor="#888"
            value={sustainmentAdmin}
            onChangeText={setSustainmentAdmin}
            style={[inputStyle, styles.tall]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Personnel</Text>
          <TextInput
            placeholderTextColor="#888"
            value={personnelStatus}
            onChangeText={setPersonnelStatus}
            style={inputStyle}
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Equipment</Text>
          <TextInput
            placeholderTextColor="#888"
            value={equipmentStatus}
            onChangeText={setEquipmentStatus}
            style={inputStyle}
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Weather</Text>
          <TextInput placeholderTextColor="#888" value={weather} onChangeText={setWeather} style={inputStyle} />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Commander&apos;s assessment</Text>
          <TextInput
            placeholderTextColor="#888"
            value={commandersAssessment}
            onChangeText={setCommandersAssessment}
            style={[inputStyle, styles.tall]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Remarks</Text>
          <TextInput
            placeholderTextColor="#888"
            value={remarks}
            onChangeText={setRemarks}
            style={[inputStyle, styles.tall]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Related mission (optional)</Text>
          <TextInput
            placeholder="Mission title reference"
            placeholderTextColor="#888"
            value={relatedMissionTitle}
            onChangeText={setRelatedMissionTitle}
            style={inputStyle}
          />

          <Pressable
            disabled={busy}
            onPress={() => void save()}
            style={[styles.saveBtn, { backgroundColor: p.tint, opacity: busy ? 0.7 : 1 }]}>
            <Text style={[styles.saveBtnText, { color: scheme === "dark" ? "#0f172a" : "#fff" }]}>
              {busy ? "Saving…" : "Save SITREP (team)"}
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
  label: { fontSize: 11, fontWeight: "700", marginTop: 10, letterSpacing: 0.4 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 2 },
  tall: { minHeight: 88, textAlignVertical: "top" },
  saveBtn: { marginTop: 20, paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  saveBtnText: { fontSize: 16, fontWeight: "800" },
});
