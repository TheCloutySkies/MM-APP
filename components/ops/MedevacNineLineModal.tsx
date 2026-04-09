import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
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
  MEDEVAC_SPECIAL_EQUIPMENT_CHOICES,
  OPS_AAD,
  type MedevacNineLinePayloadV1,
  type MedevacSpecialEquipment,
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

function Counter(props: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  muted: string;
  valColor: string;
  large?: boolean;
}) {
  const step = (d: number) => props.onChange(Math.max(0, props.value + d));
  return (
    <View style={{ marginBottom: 12, flex: 1, minWidth: 120 }}>
      <Text style={{ fontSize: 11, fontWeight: "800", color: props.muted, marginBottom: 6 }}>{props.label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Pressable onPress={() => step(-1)} style={styles.ctBtn}>
          <Text style={styles.ctBtnTx}>−</Text>
        </Pressable>
        <Text style={[styles.ctVal, { color: props.valColor }, props.large ? { fontSize: 22 } : undefined]}>{props.value}</Text>
        <Pressable onPress={() => step(1)} style={styles.ctBtn}>
          <Text style={styles.ctBtnTx}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function MedevacNineLineModal({
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

  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [urgent, setUrgent] = useState(0);
  const [priority, setPriority] = useState(0);
  const [routine, setRoutine] = useState(0);
  const [line4, setLine4] = useState<MedevacSpecialEquipment>("none");
  const [litter, setLitter] = useState(0);
  const [ambulatory, setAmbulatory] = useState(0);
  const [line6, setLine6] = useState("");
  const [line7, setLine7] = useState("");
  const [line8, setLine8] = useState("");
  const [line9, setLine9] = useState("");
  const [busy, setBusy] = useState(false);
  const [equipOpen, setEquipOpen] = useState(false);

  const precedenceTotal = urgent + priority + routine;
  const typeTotal = litter + ambulatory;

  const dispatchReady = useMemo(() => {
    if (!line1.trim() || !line2.trim()) return false;
    if (precedenceTotal < 1) return false;
    if (typeTotal < 1) return false;
    return true;
  }, [line1, line2, precedenceTotal, typeTotal]);

  const nextMandatoryLine = useMemo(() => {
    if (!line1.trim()) return 1;
    if (!line2.trim()) return 2;
    if (precedenceTotal < 1) return 3;
    if (typeTotal < 1) return 5;
    return null;
  }, [line1, line2, precedenceTotal, typeTotal]);

  const nextOptionalLine = useMemo(() => {
    if (nextMandatoryLine != null) return null;
    if (!line6.trim()) return 6;
    if (!line7.trim()) return 7;
    if (!line8.trim()) return 8;
    if (!line9.trim()) return 9;
    return null;
  }, [nextMandatoryLine, line6, line7, line8, line9]);

  const inputStyle = [
    styles.input,
    {
      color: p.text,
      borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8",
      backgroundColor: scheme === "dark" ? "#09090b" : "#fafafa",
    },
  ];

  const lineBox = (n: number, body: ReactNode) => {
    const hot = n === nextMandatoryLine || n === nextOptionalLine;
    const border = hot ? "#ef4444" : scheme === "dark" ? "#3f3f46" : "#d4d4d8";
    const mandatory = n <= 5;
    return (
      <View style={[styles.lineCard, { borderColor: border, backgroundColor: scheme === "dark" ? "#0c0c0e" : "#fff" }]}>
        <Text style={[styles.lineTitle, { color: p.text }]}>
          Line {n}
          {mandatory ? <Text style={{ color: "#ef4444", fontWeight: "900" }}> *</Text> : null}
        </Text>
        {body}
      </View>
    );
  };

  const fillGps = async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert("MEDEVAC", "Location permission is required for GPS MGRS.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const grid = lngLatToMgrs(pos.coords.latitude, pos.coords.longitude, 5);
      if (!grid) {
        Alert.alert("MEDEVAC", "Could not compute MGRS.");
        return;
      }
      setLine1(grid);
    } catch (e) {
      Alert.alert("MEDEVAC", e instanceof Error ? e.message : "GPS failed");
    }
  };

  const refineMap = () => {
    setMgrsPickHandler((grid) => {
      setLine1(grid);
      setMgrsPickHandler(null);
    });
    router.push("/(app)/map");
  };

  const send = async () => {
    if (!supabase || !profileId || !mapKey || mapKey.length !== 32) {
      Alert.alert("MEDEVAC", "Operations encryption key not available.");
      return;
    }
    if (!dispatchReady) {
      Alert.alert("MEDEVAC", "Complete lines 1–5 before sending (location, callsign/freq, patients by precedence, special equipment, patients by type).");
      return;
    }
    setBusy(true);
    try {
      const preparedBy = username?.trim() || "unknown";
      const payload: MedevacNineLinePayloadV1 = {
        v: 1,
        kind: "medevac_nine_line",
        line1_location: line1.trim(),
        line2_callsignFreq: line2.trim(),
        line3_urgent: urgent,
        line3_priority: priority,
        line3_routine: routine,
        line4_specialEquipment: line4,
        line5_litter: litter,
        line5_ambulatory: ambulatory,
        line6_securityAtPickup: line6.trim() || undefined,
        line7_markingMethod: line7.trim() || undefined,
        line8_nationalityStatus: line8.trim() || undefined,
        line9_nbCbrn: line9.trim() || undefined,
        createdAt: Date.now(),
      };
      const encrypted = encryptUtf8(mapKey, JSON.stringify(payload), OPS_AAD.medevac_nine_line);
      const { error } = await supabase.from("ops_reports").insert({
        author_id: profileId,
        author_username: preparedBy,
        doc_kind: "medevac_nine_line",
        encrypted_payload: encrypted,
        ...(operationId ? { operation_id: operationId } : {}),
      });
      if (error) throw new Error(error.message);
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert("MEDEVAC", e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const equipLabel = MEDEVAC_SPECIAL_EQUIPMENT_CHOICES.find((c) => c.id === line4)?.label ?? "Special equipment";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.wrap, { backgroundColor: p.background }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: p.text }]}>9-line MEDEVAC</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[styles.close, { color: p.tint }]}>Close</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={[styles.hint, { color: p.tabIconDefault }]}>
            Lines 1–5 are required before dispatch. The next required line is highlighted. Lines 6–9 add LZ / patient detail.
          </Text>

          {lineBox(
            1,
            <>
              <TextInput
                placeholder="Pick-up grid / MGRS"
                placeholderTextColor="#888"
                value={line1}
                onChangeText={setLine1}
                style={[inputStyle, styles.big]}
              />
              <View style={styles.rowGap}>
                <Pressable onPress={() => void fillGps()} style={[styles.miniBtn, { borderColor: p.tint }]}>
                  <Text style={[styles.miniTx, { color: p.tint }]}>GPS → MGRS</Text>
                </Pressable>
                <Pressable onPress={refineMap} style={[styles.miniBtn, { borderColor: p.tint }]}>
                  <Text style={[styles.miniTx, { color: p.tint }]}>Refine on map</Text>
                </Pressable>
              </View>
            </>,
          )}

          {lineBox(
            2,
            <TextInput
              placeholder="Callsign & frequency"
              placeholderTextColor="#888"
              value={line2}
              onChangeText={setLine2}
              style={[inputStyle, styles.big]}
            />,
          )}

          {lineBox(
            3,
            <View style={styles.counterRow}>
              <Counter label="Urgent" value={urgent} onChange={setUrgent} muted={p.tabIconDefault} valColor={p.text} large />
              <Counter label="Priority" value={priority} onChange={setPriority} muted={p.tabIconDefault} valColor={p.text} large />
              <Counter label="Routine" value={routine} onChange={setRoutine} muted={p.tabIconDefault} valColor={p.text} large />
            </View>,
          )}

          {lineBox(
            4,
            <>
              <Pressable
                onPress={() => setEquipOpen((v) => !v)}
                style={[styles.selectBtn, { borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8", backgroundColor: scheme === "dark" ? "#09090b" : "#fafafa" }]}>
                <Text style={[styles.selectTx, { color: p.text }]}>{equipLabel}</Text>
                <Text style={{ color: p.tint, fontWeight: "800" }}>{equipOpen ? "▲" : "▼"}</Text>
              </Pressable>
              {equipOpen ? (
                <View style={[styles.pickList, { borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8" }]}>
                  {MEDEVAC_SPECIAL_EQUIPMENT_CHOICES.map((c) => (
                    <Pressable
                      key={c.id}
                      onPress={() => {
                        setLine4(c.id);
                        setEquipOpen(false);
                      }}
                      style={({ pressed }) => ({
                        paddingVertical: 14,
                        paddingHorizontal: 12,
                        backgroundColor: pressed ? (scheme === "dark" ? "#18181b" : "#f4f4f5") : "transparent",
                      })}>
                      <Text style={{ color: p.text, fontWeight: line4 === c.id ? "800" : "500" }}>{c.label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </>,
          )}

          {lineBox(
            5,
            <View style={styles.counterRow}>
              <Counter label="Litter" value={litter} onChange={setLitter} muted={p.tabIconDefault} valColor={p.text} large />
              <Counter label="Ambulatory" value={ambulatory} onChange={setAmbulatory} muted={p.tabIconDefault} valColor={p.text} large />
            </View>,
          )}

          {lineBox(
            6,
            <TextInput
              placeholder="Security at pick-up site"
              placeholderTextColor="#888"
              value={line6}
              onChangeText={setLine6}
              style={[inputStyle, styles.tall]}
              multiline
            />,
          )}

          {lineBox(
            7,
            <TextInput
              placeholder="Method of marking pick-up site"
              placeholderTextColor="#888"
              value={line7}
              onChangeText={setLine7}
              style={inputStyle}
            />,
          )}

          {lineBox(
            8,
            <TextInput
              placeholder="Patient nationality and status"
              placeholderTextColor="#888"
              value={line8}
              onChangeText={setLine8}
              style={inputStyle}
            />,
          )}

          {lineBox(
            9,
            <TextInput
              placeholder="NBC / CBRN contamination"
              placeholderTextColor="#888"
              value={line9}
              onChangeText={setLine9}
              style={[inputStyle, styles.tall]}
              multiline
            />,
          )}

          <Pressable
            disabled={busy || !dispatchReady}
            onPress={() => void send()}
            style={[
              styles.sendBtn,
              {
                opacity: busy ? 0.75 : dispatchReady ? 1 : 0.45,
                backgroundColor: dispatchReady ? "#b91c1c" : "#7f1d1d",
              },
              dispatchReady
                ? Platform.OS === "ios"
                  ? {
                      shadowColor: "#ff0000",
                      shadowOffset: { width: 0, height: 0 },
                      shadowOpacity: 0.95,
                      shadowRadius: 14,
                    }
                  : Platform.OS === "android"
                    ? { elevation: 14 }
                    : Platform.OS === "web"
                      ? ({ boxShadow: "0 0 24px rgba(255,0,0,0.75)" } as const)
                      : null
                : null,
            ]}>
            <Text style={styles.sendTx}>{busy ? "Sending…" : "SEND REQUEST"}</Text>
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
  scrollContent: { paddingHorizontal: 16, paddingBottom: 48 },
  hint: { fontSize: 12, lineHeight: 17, marginBottom: 12 },
  lineCard: { borderWidth: 2, borderRadius: 14, padding: 12, marginBottom: 12 },
  lineTitle: { fontSize: 14, fontWeight: "800", marginBottom: 10 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 16 },
  big: { minHeight: 52 },
  tall: { minHeight: 88, textAlignVertical: "top" },
  rowGap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  miniBtn: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 2 },
  miniTx: { fontWeight: "800", fontSize: 13 },
  counterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  ctBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#27272a",
  },
  ctBtnTx: { color: "#fafafa", fontSize: 22, fontWeight: "800", marginTop: -2 },
  ctVal: { fontWeight: "900", color: "#e4e4e7", minWidth: 36, textAlign: "center" },
  selectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  selectTx: { fontSize: 16, fontWeight: "700" },
  pickList: { borderWidth: 1, borderRadius: 12, overflow: "hidden", marginTop: 8 },
  sendBtn: { marginTop: 8, paddingVertical: 18, borderRadius: 14, alignItems: "center" },
  sendTx: { color: "#fff", fontWeight: "900", fontSize: 17, letterSpacing: 0.6 },
});
