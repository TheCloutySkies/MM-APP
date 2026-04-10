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
    useWindowDimensions,
    View,
} from "react-native";

import { opsModalContentExtras } from "@/components/ops/opsModalScroll";
import Colors from "@/constants/Colors";
import { encryptUtf8 } from "@/lib/crypto/aesGcm";
import { OPS_AAD, type AarPayloadV1 } from "@/lib/opsReports";
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

export function AarModal({
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
  const { width: winW } = useWindowDimensions();
  const [operationTitle, setOperationTitle] = useState("");
  const [dateRange, setDateRange] = useState("");
  const [missionObjectives, setMissionObjectives] = useState("");
  const [intentSummary, setIntentSummary] = useState("");
  const [executionWhatOccurred, setExecutionWhatOccurred] = useState("");
  const [strengthsObserved, setStrengthsObserved] = useState("");
  const [deficienciesObserved, setDeficienciesObserved] = useState("");
  const [lessonsLearned, setLessonsLearned] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [sustainmentNotes, setSustainmentNotes] = useState("");
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
      Alert.alert("AAR", "Operations encryption key not available.");
      return;
    }
    if (!operationTitle.trim() || !executionWhatOccurred.trim()) {
      Alert.alert("AAR", "Operation title and execution summary are required.");
      return;
    }
    setBusy(true);
    try {
      const preparedBy = username?.trim() || "unknown";
      const payload: AarPayloadV1 = {
        v: 1,
        kind: "aar",
        operationTitle: operationTitle.trim(),
        dateRange: dateRange.trim(),
        missionObjectives: missionObjectives.trim(),
        intentSummary: intentSummary.trim(),
        executionWhatOccurred: executionWhatOccurred.trim(),
        strengthsObserved: strengthsObserved.trim(),
        deficienciesObserved: deficienciesObserved.trim(),
        lessonsLearned: lessonsLearned.trim(),
        recommendations: recommendations.trim(),
        sustainmentNotes: sustainmentNotes.trim() || undefined,
        preparedBy,
      };
      const encrypted = encryptUtf8(mapKey, JSON.stringify(payload), OPS_AAD.aar);
      const { error } = await supabase.from("ops_reports").insert({
        author_id: profileId,
        author_username: preparedBy,
        doc_kind: "aar",
        encrypted_payload: encrypted,
        ...(operationId ? { operation_id: operationId } : {}),
      });
      if (error) throw new Error(error.message);
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert("AAR", e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.wrap, { backgroundColor: p.background, minHeight: 0 }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: p.text }]}>After action report</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[styles.close, { color: p.tint }]}>Close</Text>
          </Pressable>
        </View>
        <ScrollView
          style={[styles.scroll, { minHeight: 0 }]}
          contentContainerStyle={[styles.scrollContent, opsModalContentExtras(winW, 40)]}
          keyboardShouldPersistTaps="handled">
          <Text style={[styles.hint, { color: p.tabIconDefault }]}>
            Structured AAR: objectives, execution, strengths, deficiencies, lessons, recommendations. Saved for the team
            with the same encryption as map / ops reports.
          </Text>

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Operation / event title</Text>
          <TextInput placeholderTextColor="#888" value={operationTitle} onChangeText={setOperationTitle} style={inputStyle} />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Date range</Text>
          <TextInput placeholderTextColor="#888" value={dateRange} onChangeText={setDateRange} style={inputStyle} />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Mission objectives (what was intended)</Text>
          <TextInput
            placeholderTextColor="#888"
            value={missionObjectives}
            onChangeText={setMissionObjectives}
            style={[inputStyle, styles.tall]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Commander&apos;s intent (summary)</Text>
          <TextInput
            placeholderTextColor="#888"
            value={intentSummary}
            onChangeText={setIntentSummary}
            style={[inputStyle, styles.tall]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Execution — what happened</Text>
          <TextInput
            placeholder="Timeline, key decisions, friction"
            placeholderTextColor="#888"
            value={executionWhatOccurred}
            onChangeText={setExecutionWhatOccurred}
            style={[inputStyle, styles.tall]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Strengths observed</Text>
          <TextInput
            placeholderTextColor="#888"
            value={strengthsObserved}
            onChangeText={setStrengthsObserved}
            style={[inputStyle, styles.tall]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Deficiencies observed</Text>
          <TextInput
            placeholderTextColor="#888"
            value={deficienciesObserved}
            onChangeText={setDeficienciesObserved}
            style={[inputStyle, styles.tall]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Lessons learned</Text>
          <TextInput
            placeholderTextColor="#888"
            value={lessonsLearned}
            onChangeText={setLessonsLearned}
            style={[inputStyle, styles.tall]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Recommendations</Text>
          <TextInput
            placeholderTextColor="#888"
            value={recommendations}
            onChangeText={setRecommendations}
            style={[inputStyle, styles.tall]}
            multiline
          />

          <Text style={[styles.label, { color: p.tabIconDefault }]}>Sustainment / admin notes</Text>
          <TextInput
            placeholderTextColor="#888"
            value={sustainmentNotes}
            onChangeText={setSustainmentNotes}
            style={[inputStyle, styles.tall]}
            multiline
          />

          <Pressable
            disabled={busy}
            onPress={() => void save()}
            style={[styles.saveBtn, { backgroundColor: p.tint, opacity: busy ? 0.7 : 1 }]}>
            <Text style={[styles.saveBtnText, { color: scheme === "dark" ? "#0f172a" : "#fff" }]}>
              {busy ? "Saving…" : "Save AAR (team)"}
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
  scrollContent: { paddingBottom: 0 },
  hint: { fontSize: 12, lineHeight: 17, marginBottom: 10 },
  label: { fontSize: 11, fontWeight: "700", marginTop: 10, letterSpacing: 0.4 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 2 },
  tall: { minHeight: 88, textAlignVertical: "top" },
  saveBtn: { marginTop: 20, paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  saveBtnText: { fontSize: 16, fontWeight: "800" },
});
