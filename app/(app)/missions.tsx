import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
    Alert,
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    View,
    useColorScheme,
} from "react-native";

import { AarModal } from "@/components/ops/AarModal";
import { MissionPlanModal } from "@/components/ops/MissionPlanModal";
import { SitrepModal } from "@/components/ops/SitrepModal";
import Colors from "@/constants/Colors";
import { decryptUtf8 } from "@/lib/crypto/aesGcm";
import type { MissionPlanPayloadV1 } from "@/lib/opsReports";
import { OPS_AAD, formatMissionForDisplay, previewOpsRow, type OpsDocKind } from "@/lib/opsReports";
import { resolveMapEncryptKey, useMMStore, type VaultMode } from "@/store/mmStore";

type LegacyMissionRow = { id: string; ciphertext: string; created_at: string };

type OpsRow = {
  id: string;
  encrypted_payload: string;
  created_at: string;
  doc_kind: OpsDocKind;
  author_username: string;
};

type CombinedRow =
  | { source: "legacy"; id: string; created_at: string; ciphertext: string }
  | {
      source: "ops";
      id: string;
      created_at: string;
      doc_kind: OpsDocKind;
      encrypted_payload: string;
      author_username: string;
    };

export default function MissionsScreen() {
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

  const activeVaultKey =
    vaultMode === "main" ? mainKey : vaultMode === "decoy" ? decoyKey : null;

  const [legacyRows, setLegacyRows] = useState<LegacyMissionRow[]>([]);
  const [opsRows, setOpsRows] = useState<OpsRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [showMissionModal, setShowMissionModal] = useState(false);
  const [showSitrepModal, setShowSitrepModal] = useState(false);
  const [showAarModal, setShowAarModal] = useState(false);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const [legacyRes, opsRes] = await Promise.all([
      supabase.from("missions").select("id, ciphertext, created_at").order("created_at", { ascending: false }),
      supabase
        .from("ops_reports")
        .select("id, encrypted_payload, created_at, doc_kind, author_username")
        .eq("doc_kind", "mission_plan")
        .order("created_at", { ascending: false }),
    ]);
    if (legacyRes.error) {
      console.warn(legacyRes.error.message);
      setLegacyRows([]);
    } else {
      setLegacyRows((legacyRes.data ?? []) as LegacyMissionRow[]);
    }
    if (opsRes.error) {
      console.warn(opsRes.error.message);
      setOpsRows([]);
    } else {
      setOpsRows((opsRes.data ?? []) as OpsRow[]);
    }
  }, [supabase]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const combined: CombinedRow[] = useMemo(() => {
    const L: CombinedRow[] = legacyRows.map((r) => ({
      source: "legacy",
      id: r.id,
      created_at: r.created_at,
      ciphertext: r.ciphertext,
    }));
    const O: CombinedRow[] = opsRows.map((r) => ({
      source: "ops",
      id: r.id,
      created_at: r.created_at,
      doc_kind: r.doc_kind,
      encrypted_payload: r.encrypted_payload,
      author_username: r.author_username,
    }));
    return [...O, ...L].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [legacyRows, opsRows]);

  const openRow = (item: CombinedRow) => {
    if (!mapKey || mapKey.length !== 32) {
      Alert.alert("Missions", "Set EXPO_PUBLIC_MM_MAP_SHARED_KEY or unlock main vault to decrypt team plans.");
      return;
    }
    try {
      if (item.source === "legacy") {
        if (!activeVaultKey || activeVaultKey.length !== 32) {
          Alert.alert("Legacy folder", "Unlock the vault partition used when this mission was created.");
          return;
        }
        const json = decryptUtf8(activeVaultKey, item.ciphertext, "mm-mission");
        const body = JSON.parse(json) as { name?: string; members?: string[] };
        const members = Array.isArray(body.members) ? body.members.join(", ") : "";
        Alert.alert(
          body.name ?? "Mission",
          [members && `Members: ${members}`, "Legacy private mission (pre–team ops table)."].filter(Boolean).join("\n"),
        );
        return;
      }
      const aad = OPS_AAD.mission_plan;
      const json = decryptUtf8(mapKey, item.encrypted_payload, aad);
      const parsed = JSON.parse(json) as MissionPlanPayloadV1;
      Alert.alert(
        `${parsed.title} · ${item.author_username}`,
        formatMissionForDisplay(parsed).slice(0, 3800),
      );
    } catch {
      Alert.alert("Missions", "Cannot decrypt (wrong key or author used different partition).");
    }
  };

  const sch = scheme === "dark" ? "dark" : "light";

  return (
    <View style={[styles.wrap, { backgroundColor: p.background }]}>
      <Text style={[styles.lede, { color: p.tabIconDefault }]}>
        Doctrine-style mission planning and reporting. Team plans, SITREPs, and AARs use the same encryption key as shared
        map markers when EXPO_PUBLIC_MM_MAP_SHARED_KEY is set (32-byte hex). See docs/mm-member-callsigns-example.md for
        sample callsigns.
      </Text>

      <View style={styles.actions}>
        <Pressable
          style={[styles.actionBtn, { backgroundColor: p.tint }]}
          onPress={() => {
            if (!mapKey) Alert.alert("Missions", "Encryption key unavailable. Unlock vault or set shared map key.");
            else setShowMissionModal(true);
          }}>
          <Text style={[styles.actionBtnTx, { color: sch === "dark" ? "#0f172a" : "#fff" }]}>Mission plan</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, { borderColor: p.tint, borderWidth: 1, backgroundColor: "transparent" }]}
          onPress={() => {
            if (!mapKey) Alert.alert("Missions", "Encryption key unavailable.");
            else setShowSitrepModal(true);
          }}>
          <Text style={[styles.actionBtnTxOutline, { color: p.tint }]}>SITREP</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, { borderColor: p.tint, borderWidth: 1, backgroundColor: "transparent" }]}
          onPress={() => {
            if (!mapKey) Alert.alert("Missions", "Encryption key unavailable.");
            else setShowAarModal(true);
          }}>
          <Text style={[styles.actionBtnTxOutline, { color: p.tint }]}>AAR</Text>
        </Pressable>
      </View>

      <Text style={[styles.section, { color: p.tabIconDefault }]}>Mission plans (team + legacy)</Text>
      <FlatList
        style={{ flex: 1 }}
        data={combined}
        keyExtractor={(r) => `${r.source}-${r.id}`}
        onRefresh={async () => {
          setRefreshing(true);
          await refresh();
          setRefreshing(false);
        }}
        refreshing={refreshing}
        ListEmptyComponent={<Text style={{ color: p.tabIconDefault }}>No mission plans yet.</Text>}
        renderItem={({ item }) => {
          let title = "…";
          let sub = item.created_at;
          if (item.source === "ops") {
            try {
              if (mapKey?.length === 32) {
                const json = decryptUtf8(mapKey, item.encrypted_payload, OPS_AAD.mission_plan);
                title = previewOpsRow("mission_plan", json);
              }
            } catch {
              title = "(cannot decrypt)";
            }
            sub = `${item.author_username} · ${item.created_at}`;
          } else if (item.source === "legacy" && activeVaultKey?.length === 32) {
            try {
              const json = decryptUtf8(activeVaultKey, item.ciphertext, "mm-mission");
              title = (JSON.parse(json) as { name: string }).name;
              sub = `Legacy · ${item.created_at}`;
            } catch {
              title = "(locked)";
            }
          }
          return (
            <Pressable
              style={[styles.card, { borderColor: p.tabIconDefault }]}
              onPress={() => openRow(item)}>
              <Text style={{ color: p.text, fontWeight: "700" }}>{title}</Text>
              <Text style={{ color: p.tabIconDefault, fontSize: 12 }}>{sub}</Text>
            </Pressable>
          );
        }}
      />

      <MissionPlanModal
        visible={showMissionModal}
        onClose={() => setShowMissionModal(false)}
        scheme={sch}
        supabase={supabase}
        profileId={profileId}
        username={username}
        mapKey={mapKey}
        onSaved={() => void refresh()}
      />
      <SitrepModal
        visible={showSitrepModal}
        onClose={() => setShowSitrepModal(false)}
        scheme={sch}
        supabase={supabase}
        profileId={profileId}
        username={username}
        mapKey={mapKey}
        onSaved={() => void refresh()}
      />
      <AarModal
        visible={showAarModal}
        onClose={() => setShowAarModal(false)}
        scheme={sch}
        supabase={supabase}
        profileId={profileId}
        username={username}
        mapKey={mapKey}
        onSaved={() => void refresh()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16 },
  lede: { fontSize: 12, lineHeight: 17, marginBottom: 16 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  actionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    minWidth: 100,
    alignItems: "center",
  },
  actionBtnTx: { fontWeight: "800", fontSize: 14 },
  actionBtnTxOutline: { fontWeight: "800", fontSize: 14 },
  section: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  card: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
});
