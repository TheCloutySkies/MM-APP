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
import { OPERATION_HUB_AAD, type OperationHubPayloadV1 } from "@/lib/opsReports";
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

export function OperationHubModal({
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
  const [title, setTitle] = useState("");
  const [codename, setCodename] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!supabase || !profileId || !mapKey || mapKey.length !== 32) {
      Alert.alert("Operation", "Encryption key unavailable.");
      return;
    }
    if (!title.trim()) {
      Alert.alert("Operation", "Title is required.");
      return;
    }
    setBusy(true);
    try {
      const payload: OperationHubPayloadV1 = {
        v: 1,
        kind: "operation_hub",
        title: title.trim(),
        codename: codename.trim() || undefined,
        notes: notes.trim() || undefined,
        createdAt: Date.now(),
      };
      const encrypted = encryptUtf8(mapKey, JSON.stringify(payload), OPERATION_HUB_AAD);
      const { error } = await supabase.from("operation_hubs").insert({
        author_id: profileId,
        author_username: username?.trim() || "unknown",
        encrypted_payload: encrypted,
      });
      if (error) throw new Error(error.message);
      setTitle("");
      setCodename("");
      setNotes("");
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert("Operation", e instanceof Error ? e.message : "Save failed");
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
          <Text style={[styles.headerTitle, { color: p.text }]}>New operation</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[styles.close, { color: p.tint }]}>Close</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={[styles.hint, { color: p.tabIconDefault }]}>
            Creates a mission hub others can open — reports can be scoped to this operation. Encrypted like map markers.
          </Text>
          <Text style={[styles.label, { color: p.tabIconDefault }]}>Operation title</Text>
          <TextInput value={title} onChangeText={setTitle} style={inputStyle} placeholderTextColor="#888" />
          <Text style={[styles.label, { color: p.tabIconDefault }]}>Codename (optional)</Text>
          <TextInput value={codename} onChangeText={setCodename} style={inputStyle} placeholderTextColor="#888" />
          <Text style={[styles.label, { color: p.tabIconDefault }]}>Notes (optional)</Text>
          <TextInput value={notes} onChangeText={setNotes} style={[inputStyle, styles.tall]} multiline />
          <Pressable
            disabled={busy}
            onPress={() => void save()}
            style={[styles.saveBtn, { backgroundColor: p.tint, opacity: busy ? 0.7 : 1 }]}>
            <Text style={[styles.saveTx, { color: scheme === "dark" ? "#0f172a" : "#fff" }]}>
              {busy ? "Saving…" : "Create operation"}
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
  scrollContent: { paddingHorizontal: 16, paddingBottom: 32 },
  hint: { fontSize: 12, lineHeight: 17, marginBottom: 10 },
  label: { fontSize: 11, fontWeight: "700", marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15 },
  tall: { minHeight: 88, textAlignVertical: "top" },
  saveBtn: { marginTop: 20, paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  saveTx: { fontSize: 16, fontWeight: "800" },
});
