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
import { OPS_AAD, type TargetPackagePayloadV1 } from "@/lib/opsReports";
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

export function TargetPackageModal({
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
  const [objectiveName, setObjectiveName] = useState("");
  const [coordinates, setCoordinates] = useState("");
  const [infilRoutes, setInfilRoutes] = useState("");
  const [exfilRoutes, setExfilRoutes] = useState("");
  const [hvtDescription, setHvtDescription] = useState("");
  const [commPlan, setCommPlan] = useState("");
  const [carverNotes, setCarverNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setObjectiveName("");
    setCoordinates("");
    setInfilRoutes("");
    setExfilRoutes("");
    setHvtDescription("");
    setCommPlan("");
    setCarverNotes("");
  };

  const save = async () => {
    if (!supabase || !profileId || !mapKey || mapKey.length !== 32) {
      Alert.alert("Target package", "Unlock vault / ops key not available.");
      return;
    }
    if (!objectiveName.trim()) {
      Alert.alert("Target package", "Objective name is required.");
      return;
    }
    setBusy(true);
    try {
      const payload: TargetPackagePayloadV1 = {
        v: 1,
        kind: "target_package",
        objectiveName: objectiveName.trim(),
        coordinates: coordinates.trim(),
        infilRoutes: infilRoutes.trim(),
        exfilRoutes: exfilRoutes.trim(),
        hvtDescription: hvtDescription.trim(),
        commPlan: commPlan.trim(),
        carverNotes: carverNotes.trim() || undefined,
        createdAt: Date.now(),
      };
      const encrypted = encryptUtf8(mapKey, JSON.stringify(payload), OPS_AAD.target_package);
      const { error } = await supabase.from("ops_reports").insert({
        author_id: profileId,
        author_username: username?.trim() || "unknown",
        doc_kind: "target_package",
        encrypted_payload: encrypted,
        ...(operationId ? { operation_id: operationId } : {}),
      });
      if (error) throw new Error(error.message);
      reset();
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert("Target package", e instanceof Error ? e.message : "Save failed");
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
          <Text style={[styles.headerTitle, { color: p.text }]}>Target package</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[styles.close, { color: p.tint }]}>Close</Text>
          </Pressable>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <Text style={[styles.hint, { color: p.tabIconDefault }]}>
            Objective packet / CARVER-oriented fields. Encrypted for the team before upload.
          </Text>
          <Text style={[styles.label, { color: p.tabIconDefault }]}>Objective name</Text>
          <TextInput value={objectiveName} onChangeText={setObjectiveName} style={inputStyle} placeholderTextColor="#888" />
          <Text style={[styles.label, { color: p.tabIconDefault }]}>Coordinates / location reference</Text>
          <TextInput
            value={coordinates}
            onChangeText={setCoordinates}
            style={[inputStyle, styles.tall]}
            multiline
            placeholderTextColor="#888"
          />
          <Text style={[styles.label, { color: p.tabIconDefault }]}>Infil route(s)</Text>
          <TextInput value={infilRoutes} onChangeText={setInfilRoutes} style={[inputStyle, styles.tall]} multiline />
          <Text style={[styles.label, { color: p.tabIconDefault }]}>Exfil route(s)</Text>
          <TextInput value={exfilRoutes} onChangeText={setExfilRoutes} style={[inputStyle, styles.tall]} multiline />
          <Text style={[styles.label, { color: p.tabIconDefault }]}>HVT / objective description</Text>
          <TextInput value={hvtDescription} onChangeText={setHvtDescription} style={[inputStyle, styles.tall]} multiline />
          <Text style={[styles.label, { color: p.tabIconDefault }]}>Comm plan</Text>
          <TextInput value={commPlan} onChangeText={setCommPlan} style={[inputStyle, styles.tall]} multiline />
          <Text style={[styles.label, { color: p.tabIconDefault }]}>CARVER / notes</Text>
          <TextInput value={carverNotes} onChangeText={setCarverNotes} style={[inputStyle, styles.tall]} multiline />
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
  scrollContent: { paddingHorizontal: 16, paddingBottom: 32, gap: 6 },
  hint: { fontSize: 12, lineHeight: 17, marginBottom: 8 },
  label: { fontSize: 11, fontWeight: "700", marginTop: 10, letterSpacing: 0.4 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15 },
  tall: { minHeight: 72, textAlignVertical: "top" },
  saveBtn: { marginTop: 20, paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  saveBtnText: { fontSize: 16, fontWeight: "800" },
});
