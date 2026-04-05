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
import {
    OPS_AAD,
    parseMembersInput,
    type ExerciseNature,
    type MissionPlanPayloadV1,
} from "@/lib/opsReports";
import type { SupabaseClient } from "@supabase/supabase-js";

const EXERCISE_OPTIONS: { id: ExerciseNature; label: string }[] = [
  { id: "live_operation", label: "Live op" },
  { id: "patrol", label: "Patrol" },
  { id: "training_exercise", label: "Exercise" },
  { id: "other", label: "Other" },
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
  /** When set, report is scoped to this operation hub */
  operationId?: string | null;
};

export function MissionPlanModal({
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
  const [title, setTitle] = useState("");
  const [locations, setLocations] = useState("");
  const [operationType, setOperationType] = useState("");
  const [enemySizeDisposition, setEnemySizeDisposition] = useState("");
  const [formationTaskOrg, setFormationTaskOrg] = useState("");
  const [infrastructureNotes, setInfrastructureNotes] = useState("");
  const [weaponryEquipment, setWeaponryEquipment] = useState("");
  const [exerciseNature, setExerciseNature] = useState<ExerciseNature>("training_exercise");
  const [exerciseNatureDetail, setExerciseNatureDetail] = useState("");
  const [membersRaw, setMembersRaw] = useState("Charlie\nSierra\nAlpha Kilo");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setTitle("");
    setLocations("");
    setOperationType("");
    setEnemySizeDisposition("");
    setFormationTaskOrg("");
    setInfrastructureNotes("");
    setWeaponryEquipment("");
    setExerciseNature("training_exercise");
    setExerciseNatureDetail("");
    setMembersRaw("Charlie\nSierra\nAlpha Kilo");
    setNotes("");
  };

  const save = async () => {
    if (!supabase || !profileId || !mapKey || mapKey.length !== 32) {
      Alert.alert("Mission plan", "Unlock vault / operations key not available.");
      return;
    }
    if (!title.trim()) {
      Alert.alert("Mission plan", "Add a mission title.");
      return;
    }
    setBusy(true);
    try {
      const payload: MissionPlanPayloadV1 = {
        v: 1,
        kind: "mission_plan",
        title: title.trim(),
        locations: locations.trim(),
        operationType: operationType.trim(),
        enemySizeDisposition: enemySizeDisposition.trim(),
        formationTaskOrg: formationTaskOrg.trim(),
        infrastructureNotes: infrastructureNotes.trim(),
        weaponryEquipment: weaponryEquipment.trim(),
        exerciseNature,
        exerciseNatureDetail: exerciseNatureDetail.trim() || undefined,
        requiredMembers: parseMembersInput(membersRaw),
        notes: notes.trim() || undefined,
        createdAt: Date.now(),
      };
      const encrypted = encryptUtf8(mapKey, JSON.stringify(payload), OPS_AAD.mission_plan);
      const { error } = await supabase.from("ops_reports").insert({
        author_id: profileId,
        author_username: username?.trim() || "unknown",
        doc_kind: "mission_plan",
        encrypted_payload: encrypted,
        ...(operationId ? { operation_id: operationId } : {}),
      });
      if (error) throw new Error(error.message);
      reset();
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert("Mission plan", e instanceof Error ? e.message : "Save failed");
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
          <Text style={[styles.headerTitle, { color: p.text }]}>Mission plan</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[styles.close, { color: p.tint }]}>Close</Text>
          </Pressable>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <Text style={[styles.hint, { color: p.tabIconDefault }]}>
            Doctrine-style fields. Stored encrypted; team members use the same key as shared map markers
            (set EXPO_PUBLIC_MM_MAP_SHARED_KEY for a unit-wide key). Example callsigns: docs/mm-member-callsigns-example.md
          </Text>

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Mission title</Text>
          <TextInput placeholder="Operation name" placeholderTextColor="#888" value={title} onChangeText={setTitle} style={inputStyle} />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Locations / AO</Text>
          <TextInput
            placeholder="Grids, towns, phase lines…"
            placeholderTextColor="#888"
            value={locations}
            onChangeText={setLocations}
            style={[inputStyle, styles.multiline]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Operation type</Text>
          <TextInput
            placeholder="e.g. reconnaissance, security, cordon & search"
            placeholderTextColor="#888"
            value={operationType}
            onChangeText={setOperationType}
            style={inputStyle}
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Exercise vs real world</Text>
          <View style={styles.chipRow}>
            {EXERCISE_OPTIONS.map((opt) => (
              <Pressable
                key={opt.id}
                style={[
                  styles.chip,
                  {
                    borderColor: exerciseNature === opt.id ? p.tint : p.tabIconDefault,
                    backgroundColor: exerciseNature === opt.id ? (scheme === "dark" ? "#1e293b" : "#eff6ff") : "transparent",
                  },
                ]}
                onPress={() => setExerciseNature(opt.id)}>
                <Text style={{ color: p.text, fontWeight: "600", fontSize: 13 }}>{opt.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            placeholder="Optional detail (e.g. named exercise title)"
            placeholderTextColor="#888"
            value={exerciseNatureDetail}
            onChangeText={setExerciseNatureDetail}
            style={inputStyle}
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Enemy — size & disposition</Text>
          <TextInput
            placeholder="Strength estimate, known locations, intent…"
            placeholderTextColor="#888"
            value={enemySizeDisposition}
            onChangeText={setEnemySizeDisposition}
            style={[inputStyle, styles.multiline]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Formation / task org</Text>
          <TextInput
            placeholder="Elements, teams, attachments…"
            placeholderTextColor="#888"
            value={formationTaskOrg}
            onChangeText={setFormationTaskOrg}
            style={[inputStyle, styles.multiline]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Infrastructure</Text>
          <TextInput
            placeholder="Lines of comms, key terrain, bridges, power…"
            placeholderTextColor="#888"
            value={infrastructureNotes}
            onChangeText={setInfrastructureNotes}
            style={[inputStyle, styles.multiline]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Weaponry & equipment</Text>
          <TextInput
            placeholder="Authorised loads, crew-served, special equipment…"
            placeholderTextColor="#888"
            value={weaponryEquipment}
            onChangeText={setWeaponryEquipment}
            style={[inputStyle, styles.multiline]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Required members (callsigns / roster)</Text>
          <TextInput
            placeholder="One per line or comma-separated"
            placeholderTextColor="#888"
            value={membersRaw}
            onChangeText={setMembersRaw}
            style={[inputStyle, styles.membersBox]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Notes</Text>
          <TextInput
            placeholder="CCIR, constraints, coordinating instructions…"
            placeholderTextColor="#888"
            value={notes}
            onChangeText={setNotes}
            style={[inputStyle, styles.multiline]}
            multiline
          />

          <Pressable
            disabled={busy}
            onPress={() => void save()}
            style={[styles.saveBtn, { backgroundColor: p.tint, opacity: busy ? 0.7 : 1 }]}>
            <Text style={[styles.saveBtnText, { color: scheme === "dark" ? "#0f172a" : "#fff" }]}>
              {busy ? "Saving…" : "Save mission plan (team vault)"}
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
  scrollContent: { paddingHorizontal: 16, paddingBottom: 32, gap: 6 },
  hint: { fontSize: 12, lineHeight: 17, marginBottom: 8 },
  label: { fontSize: 11, fontWeight: "700", marginTop: 10, letterSpacing: 0.4 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15 },
  multiline: { minHeight: 72, textAlignVertical: "top" },
  membersBox: { minHeight: 100, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6, marginBottom: 6 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  saveBtn: { marginTop: 20, paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  saveBtnText: { fontSize: 16, fontWeight: "800" },
});
