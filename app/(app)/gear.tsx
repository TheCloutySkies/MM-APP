import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";

import Colors from "@/constants/Colors";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { encryptUtf8, decryptUtf8 } from "@/lib/crypto/aesGcm";
import { GEAR_LOADOUT_AAD, type GearLineItem, type GearLoadoutPayloadV1 } from "@/lib/opsReports";
import { resolveMapEncryptKey, useMMStore, type VaultMode } from "@/store/mmStore";

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

type Row = {
  id: string;
  author_username: string;
  encrypted_payload: string;
  created_at: string;
};

const EMPTY_LINES: GearLineItem[] = [];

export default function GearScreen() {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);
  const username = useMMStore((s) => s.username);
  const vaultMode = useMMStore((s) => s.vaultMode) as VaultMode | null;
  const mainKey = useMMStore((s) => s.mainVaultKey);
  const decoyKey = useMMStore((s) => s.decoyVaultKey);

  const mapKey = useMemo(() => {
    try {
      return resolveMapEncryptKey(mainKey, decoyKey, vaultMode);
    } catch {
      return null;
    }
  }, [mainKey, decoyKey, vaultMode]);

  const [rows, setRows] = useState<Row[]>([]);
  const [loadoutName, setLoadoutName] = useState("");
  const [l1, setL1] = useState("");
  const [l2, setL2] = useState("");
  const [l3, setL3] = useState("");

  const linesFromRaw = (raw: string): GearLineItem[] =>
    raw
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label) => ({ id: newId(), label, packed: false }));

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("gear_loadouts")
      .select("id, author_username, encrypted_payload, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      Alert.alert("Gear", error.message);
      return;
    }
    setRows((data ?? []) as Row[]);
  }, [supabase]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const save = async () => {
    if (!supabase || !profileId || !mapKey || mapKey.length !== 32) {
      Alert.alert("Gear", "Decrypt key unavailable.");
      return;
    }
    if (!loadoutName.trim()) {
      Alert.alert("Gear", "Name this loadout.");
      return;
    }
    const payload: GearLoadoutPayloadV1 = {
      v: 1,
      name: loadoutName.trim(),
      line1: linesFromRaw(l1),
      line2: linesFromRaw(l2),
      line3: linesFromRaw(l3),
      createdAt: Date.now(),
    };
    const enc = encryptUtf8(mapKey, JSON.stringify(payload), GEAR_LOADOUT_AAD);
    const { error } = await supabase.from("gear_loadouts").insert({
      author_id: profileId,
      author_username: username?.trim() || "unknown",
      encrypted_payload: enc,
    });
    if (error) {
      Alert.alert("Gear", error.message);
      return;
    }
    setLoadoutName("");
    setL1("");
    setL2("");
    setL3("");
    void refresh();
  };

  const openRow = (row: Row) => {
    if (!mapKey || mapKey.length !== 32) return;
    try {
      const json = decryptUtf8(mapKey, row.encrypted_payload, GEAR_LOADOUT_AAD);
      const o = JSON.parse(json) as GearLoadoutPayloadV1;
      const block = (label: string, items: GearLineItem[]) =>
        `${label}\n${items.map((x) => `  [${x.packed ? "x" : " "}] ${x.label}`).join("\n") || "  —"}`;
      Alert.alert(
        o.name,
        [block("Line 1 · on body", o.line1 ?? EMPTY_LINES), block("Line 2 · fighting load", o.line2 ?? EMPTY_LINES), block(
          "Line 3 · sustainment",
          o.line3 ?? EMPTY_LINES,
        )].join("\n\n"),
      );
    } catch {
      Alert.alert("Gear", "Cannot decrypt.");
    }
  };

  const input = [
    styles.input,
    {
      color: p.text,
      borderColor: scheme === "dark" ? "#3f3f46" : "#d4d4d8",
      backgroundColor: scheme === "dark" ? "#09090b" : "#fafafa",
    },
  ];

  return (
    <View style={[styles.wrap, { backgroundColor: p.background }]}>
      <Text style={[styles.lede, { color: p.tabIconDefault }]}>
        Line 1–3 loadouts (one item per line in each box). Stored encrypted like bulletin / ops.
      </Text>
      <Text style={[styles.label, { color: p.tabIconDefault }]}>Loadout name</Text>
      <TextInput value={loadoutName} onChangeText={setLoadoutName} style={input} placeholderTextColor="#888" />
      <Text style={[styles.label, { color: p.tabIconDefault }]}>Line 1 — on body</Text>
      <TextInput
        value={l1}
        onChangeText={setL1}
        style={[input, styles.multiline]}
        multiline
        placeholderTextColor="#888"
        placeholder="One item per line"
      />
      <Text style={[styles.label, { color: p.tabIconDefault }]}>Line 2 — fighting load</Text>
      <TextInput
        value={l2}
        onChangeText={setL2}
        style={[input, styles.multiline]}
        multiline
        placeholderTextColor="#888"
      />
      <Text style={[styles.label, { color: p.tabIconDefault }]}>Line 3 — sustainment</Text>
      <TextInput
        value={l3}
        onChangeText={setL3}
        style={[input, styles.multiline]}
        multiline
        placeholderTextColor="#888"
      />
      <Pressable style={[styles.save, { backgroundColor: p.tint }]} onPress={() => void save()}>
        <Text style={[styles.saveTx, { color: scheme === "dark" ? "#0f172a" : "#fff" }]}>Save loadout</Text>
      </Pressable>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        style={{ marginTop: 16 }}
        ListHeaderComponent={<Text style={[styles.listHead, { color: p.tabIconDefault }]}>Saved loadouts</Text>}
        renderItem={({ item }) => {
          let name = "…";
          if (mapKey?.length === 32) {
            try {
              const json = decryptUtf8(mapKey, item.encrypted_payload, GEAR_LOADOUT_AAD);
              name = (JSON.parse(json) as GearLoadoutPayloadV1).name;
            } catch {
              name = "(locked)";
            }
          }
          return (
            <Pressable style={[styles.card, { borderColor: TacticalPalette.border }]} onPress={() => openRow(item)}>
              <Text style={[styles.cardTitle, { color: p.text }]}>{name}</Text>
              <Text style={[styles.cardMeta, { color: p.tabIconDefault }]}>
                {item.author_username} · {item.created_at}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16 },
  lede: { fontSize: 12, lineHeight: 17, marginBottom: 12 },
  label: { fontSize: 11, fontWeight: "700", marginTop: 8 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15, marginTop: 4 },
  multiline: { minHeight: 72, textAlignVertical: "top" },
  save: { marginTop: 14, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  saveTx: { fontSize: 16, fontWeight: "800" },
  listHead: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: "700" },
  cardMeta: { fontSize: 12, marginTop: 4 },
});
