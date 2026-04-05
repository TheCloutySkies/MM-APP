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
import { OPS_AAD, type IntelReportBranch, type IntelReportPayloadV1 } from "@/lib/opsReports";
import type { SupabaseClient } from "@supabase/supabase-js";

const BRANCHES: { id: IntelReportBranch; label: string }[] = [
  { id: "area", label: "Area" },
  { id: "observed_activity", label: "Observed (SALUTE)" },
  { id: "individuals", label: "Individuals" },
];

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

export function IntelReportModal({
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
  const p = Colors[scheme];
  const [branch, setBranch] = useState<IntelReportBranch>("area");
  const [title, setTitle] = useState("");
  const [terrain, setTerrain] = useState("");
  const [weatherImpact, setWeatherImpact] = useState("");
  const [keyInfrastructure, setKeyInfrastructure] = useState("");
  const [salSize, setSalSize] = useState("");
  const [salActivity, setSalActivity] = useState("");
  const [salLocation, setSalLocation] = useState("");
  const [salUnit, setSalUnit] = useState("");
  const [salTime, setSalTime] = useState("");
  const [salEquipment, setSalEquipment] = useState("");
  const [physicalDescription, setPhysicalDescription] = useState("");
  const [affiliations, setAffiliations] = useState("");
  const [threatLevel, setThreatLevel] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!supabase || !profileId || !mapKey || mapKey.length !== 32) {
      Alert.alert("Intel report", "Ops encryption key not available.");
      return;
    }
    if (!title.trim()) {
      Alert.alert("Intel report", "Title / subject is required.");
      return;
    }
    setBusy(true);
    try {
      const payload: IntelReportPayloadV1 = {
        v: 1,
        kind: "intel_report",
        branch,
        title: title.trim(),
        terrain: terrain.trim() || undefined,
        weatherImpact: weatherImpact.trim() || undefined,
        keyInfrastructure: keyInfrastructure.trim() || undefined,
        saluteSize: salSize.trim() || undefined,
        saluteActivity: salActivity.trim() || undefined,
        saluteLocation: salLocation.trim() || undefined,
        saluteUnit: salUnit.trim() || undefined,
        saluteTime: salTime.trim() || undefined,
        saluteEquipment: salEquipment.trim() || undefined,
        physicalDescription: physicalDescription.trim() || undefined,
        affiliations: affiliations.trim() || undefined,
        threatLevel: threatLevel.trim() || undefined,
        remarks: remarks.trim() || undefined,
        createdAt: Date.now(),
      };
      const encrypted = encryptUtf8(mapKey, JSON.stringify(payload), OPS_AAD.intel_report);
      const { error } = await supabase.from("ops_reports").insert({
        author_id: profileId,
        author_username: username?.trim() || "unknown",
        doc_kind: "intel_report",
        encrypted_payload: encrypted,
        ...(operationId ? { operation_id: operationId } : {}),
      });
      if (error) throw new Error(error.message);
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert("Intel report", e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = [
    styles.input,
    {
      color: p.text,
      borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8",
      backgroundColor: scheme === "dark" ? "#09090b" : "#fafafa",
    },
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.wrap, { backgroundColor: p.background }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: p.text }]}>Intel report</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[styles.close, { color: p.tint }]}>Close</Text>
          </Pressable>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <Text style={[styles.hint, { color: p.tabIconDefault }]}>
            Branch the narrative: terrain & infrastructure, SALUTE activity, or individuals / threats. Encrypted client-side.
          </Text>
          <Text style={[styles.label, { color: p.tabIconDefault }]}>Branch</Text>
          <View style={styles.chipRow}>
            {BRANCHES.map((b) => (
              <Pressable
                key={b.id}
                onPress={() => setBranch(b.id)}
                style={[
                  styles.chip,
                  {
                    borderColor: branch === b.id ? p.tint : p.tabIconDefault,
                    backgroundColor: branch === b.id ? (scheme === "dark" ? "#1e293b" : "#eff6ff") : "transparent",
                  },
                ]}>
                <Text style={{ color: p.text, fontWeight: "700", fontSize: 13 }}>{b.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.label, { color: p.tabIconDefault }]}>Title</Text>
          <TextInput value={title} onChangeText={setTitle} style={inputStyle} placeholderTextColor="#888" />
          {branch === "area" ? (
            <>
              <Text style={[styles.label, { color: p.tabIconDefault }]}>Terrain</Text>
              <TextInput value={terrain} onChangeText={setTerrain} style={[inputStyle, styles.tall]} multiline />
              <Text style={[styles.label, { color: p.tabIconDefault }]}>Weather impact</Text>
              <TextInput value={weatherImpact} onChangeText={setWeatherImpact} style={[inputStyle, styles.tall]} multiline />
              <Text style={[styles.label, { color: p.tabIconDefault }]}>Key infrastructure</Text>
              <TextInput
                value={keyInfrastructure}
                onChangeText={setKeyInfrastructure}
                style={[inputStyle, styles.tall]}
                multiline
              />
            </>
          ) : null}
          {branch === "observed_activity" ? (
            <>
              <Text style={[styles.label, { color: p.tabIconDefault }]}>SALUTE — Size</Text>
              <TextInput value={salSize} onChangeText={setSalSize} style={inputStyle} />
              <Text style={[styles.label, { color: p.tabIconDefault }]}>SALUTE — Activity</Text>
              <TextInput value={salActivity} onChangeText={setSalActivity} style={inputStyle} />
              <Text style={[styles.label, { color: p.tabIconDefault }]}>SALUTE — Location</Text>
              <TextInput value={salLocation} onChangeText={setSalLocation} style={inputStyle} />
              <Text style={[styles.label, { color: p.tabIconDefault }]}>SALUTE — Unit</Text>
              <TextInput value={salUnit} onChangeText={setSalUnit} style={inputStyle} />
              <Text style={[styles.label, { color: p.tabIconDefault }]}>SALUTE — Time</Text>
              <TextInput value={salTime} onChangeText={setSalTime} style={inputStyle} />
              <Text style={[styles.label, { color: p.tabIconDefault }]}>SALUTE — Equipment</Text>
              <TextInput value={salEquipment} onChangeText={setSalEquipment} style={inputStyle} />
            </>
          ) : null}
          {branch === "individuals" ? (
            <>
              <Text style={[styles.label, { color: p.tabIconDefault }]}>Physical description</Text>
              <TextInput
                value={physicalDescription}
                onChangeText={setPhysicalDescription}
                style={[inputStyle, styles.tall]}
                multiline
              />
              <Text style={[styles.label, { color: p.tabIconDefault }]}>Affiliations</Text>
              <TextInput value={affiliations} onChangeText={setAffiliations} style={[inputStyle, styles.tall]} multiline />
              <Text style={[styles.label, { color: p.tabIconDefault }]}>Threat level</Text>
              <TextInput value={threatLevel} onChangeText={setThreatLevel} style={inputStyle} />
            </>
          ) : null}
          <Text style={[styles.label, { color: p.tabIconDefault }]}>Remarks</Text>
          <TextInput value={remarks} onChangeText={setRemarks} style={[inputStyle, styles.tall]} multiline />
          <Pressable
            disabled={busy}
            onPress={() => void save()}
            style={[styles.saveBtn, { backgroundColor: p.tint, opacity: busy ? 0.7 : 1 }]}>
            <Text style={[styles.saveBtnText, { color: scheme === "dark" ? "#0f172a" : "#fff" }]}>
              {busy ? "Saving…" : "Save (encrypted)"}
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
  scrollContent: { paddingHorizontal: 16, paddingBottom: 32, gap: 4 },
  hint: { fontSize: 12, lineHeight: 17, marginBottom: 8 },
  label: { fontSize: 11, fontWeight: "700", marginTop: 10, letterSpacing: 0.4 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15 },
  tall: { minHeight: 72, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 10 },
  saveBtn: { marginTop: 20, paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  saveBtnText: { fontSize: 16, fontWeight: "800" },
});
