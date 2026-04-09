import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
    useColorScheme,
} from "react-native";

import { MissionPlanModal } from "@/components/ops/MissionPlanModal";
import { MissionPlanTeamModal } from "@/components/ops/MissionPlanTeamModal";
import { OperationHubModal } from "@/components/ops/OperationHubModal";
import Colors from "@/constants/Colors";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { decryptUtf8 } from "@/lib/crypto/aesGcm";
import {
    OPERATION_HUB_AAD,
    OPS_AAD,
    formatMissionForDisplay,
    previewOpsRow,
    tryDecryptUtf8WithKeys,
    type MissionPlanPayloadV1,
    type OperationHubPayloadV1,
    type OpsDocKind,
} from "@/lib/opsReports";
import { collectOpsDecryptCandidates, resolveMapEncryptKey, useMMStore, type VaultMode } from "@/store/mmStore";

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

type HubRow = {
  id: string;
  encrypted_payload: string;
  created_at: string;
  author_username: string;
};

export default function MissionsScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);
  const username = useMMStore((s) => s.username);
  const vaultMode = useMMStore((s) => s.vaultMode) as VaultMode | null;
  const mainKey = useMMStore((s) => s.mainVaultKey);
  const decoyKey = useMMStore((s) => s.decoyVaultKey);

  const teamMapSharedKeyHex = useMMStore((s) => s.teamMapSharedKeyHex);

  const mapKey = useMemo(() => {
    try {
      return resolveMapEncryptKey(mainKey, decoyKey, vaultMode);
    } catch {
      return null;
    }
  }, [mainKey, decoyKey, vaultMode, teamMapSharedKeyHex]);

  const decryptCandidates = useMemo(
    () => collectOpsDecryptCandidates(mainKey, decoyKey, vaultMode),
    [mainKey, decoyKey, vaultMode, teamMapSharedKeyHex],
  );

  const activeVaultKey =
    vaultMode === "main" ? mainKey : vaultMode === "decoy" ? decoyKey : null;

  const [legacyRows, setLegacyRows] = useState<LegacyMissionRow[]>([]);
  const [opsRows, setOpsRows] = useState<OpsRow[]>([]);
  const [hubs, setHubs] = useState<HubRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [showMissionModal, setShowMissionModal] = useState(false);
  const [showOpHubModal, setShowOpHubModal] = useState(false);
  const [teamMission, setTeamMission] = useState<{
    headerTitle: string;
    bodyText: string;
    opsReportId: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const [legacyRes, opsRes, hubsRes] = await Promise.all([
      supabase.from("missions").select("id, ciphertext, created_at").order("created_at", { ascending: false }),
      supabase
        .from("ops_reports")
        .select("id, encrypted_payload, created_at, doc_kind, author_username")
        .eq("doc_kind", "mission_plan")
        .order("created_at", { ascending: false }),
      supabase
        .from("operation_hubs")
        .select("id, encrypted_payload, created_at, author_username")
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
    if (hubsRes.error) {
      console.warn(hubsRes.error.message);
      setHubs([]);
    } else {
      setHubs((hubsRes.data ?? []) as HubRow[]);
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
      if (decryptCandidates.length === 0) {
        Alert.alert(
          "Missions",
          "No team decrypt key. Unlock your vault or set the same 64-char team key in Settings that the author used.",
        );
        return;
      }
      const aad = OPS_AAD.mission_plan;
      const json = tryDecryptUtf8WithKeys(item.encrypted_payload, aad, decryptCandidates);
      if (!json) {
        Alert.alert(
          "Missions",
          "Cannot decrypt this plan. In Settings → Team operations key, paste the same 64-character hex the unit shares (or unlock the vault partition the author used).",
        );
        return;
      }
      const parsed = JSON.parse(json) as MissionPlanPayloadV1;
      setTeamMission({
        headerTitle: `${parsed.title} · ${item.author_username}`,
        bodyText: formatMissionForDisplay(parsed),
        opsReportId: item.id,
      });
    } catch {
      Alert.alert("Missions", "Cannot decrypt (wrong key or author used different partition).");
    }
  };

  const sch = scheme === "dark" ? "dark" : "light";

  return (
    <View style={[styles.wrap, { backgroundColor: p.background }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={[styles.lede, { color: p.tabIconDefault }]}>
          Doctrine-style mission planning. Create an operation first — that becomes the dashboard shell where mission plans
          roll up; file field reports from the <Text style={{ fontWeight: "800" }}>Reports</Text> tab or inside an operation
          hub. Team crypto uses the same 32-byte key as map markers: set EXPO_PUBLIC_MM_MAP_SHARED_KEY in the build, or
          paste the identical 64-character hex under Settings → Team operations key so you can open the same ciphertext as
          your unit without rebuilding.
        </Text>

        <Text style={[styles.section, { color: p.tabIconDefault }]}>New operation</Text>
        <Pressable
          style={[styles.actionBtnPrimary, { backgroundColor: p.tint }]}
          onPress={() => {
            if (!mapKey) Alert.alert("Missions", "Encryption key unavailable.");
            else setShowOpHubModal(true);
          }}>
          <Text style={[styles.actionBtnTx, { color: sch === "dark" ? "#0f172a" : "#fff" }]}>Create operation hub</Text>
        </Pressable>

        <Text style={[styles.section, { color: p.tabIconDefault, marginTop: 18 }]}>Mission plan</Text>
        <Text style={[styles.hint, { color: p.tabIconDefault }]}>
          Lock the operational picture inside an operation (open a hub from the list). Plans you save here can be opened
          from that hub’s dashboard next.
        </Text>
        <Pressable
          style={[styles.actionBtnPrimary, { backgroundColor: TacticalPalette.elevated, borderWidth: 1, borderColor: p.tint }]}
          onPress={() => {
            if (!mapKey) Alert.alert("Missions", "Encryption key unavailable. Unlock vault or set shared map key.");
            else setShowMissionModal(true);
          }}>
          <Text style={[styles.actionBtnTxOutline, { color: p.tint }]}>New mission plan</Text>
        </Pressable>

        <Text style={[styles.section, { color: p.tabIconDefault }]}>Operations (dashboard)</Text>
        {hubs.length === 0 ? (
          <Text style={{ color: p.tabIconDefault, marginBottom: 8 }}>No operation hubs yet.</Text>
        ) : null}
        {hubs.map((item) => {
          let title = "Operation";
          if (decryptCandidates.length === 0) {
            title = "(need team key or vault)";
          } else {
            const j = tryDecryptUtf8WithKeys(item.encrypted_payload, OPERATION_HUB_AAD, decryptCandidates);
            if (j) {
              try {
                title = (JSON.parse(j) as OperationHubPayloadV1).title;
              } catch {
                title = "(cannot decrypt)";
              }
            } else {
              title = "(cannot decrypt)";
            }
          }
          return (
            <Pressable
              key={item.id}
              style={[styles.card, { borderColor: p.tabIconDefault, marginBottom: 8 }]}
              onPress={() =>
                router.push({
                  pathname: "/(app)/operation-detail",
                  params: { id: item.id },
                })
              }>
              <Text style={{ color: p.text, fontWeight: "700" }}>{title}</Text>
              <Text style={{ color: p.tabIconDefault, fontSize: 12 }}>
                {item.author_username} · {item.created_at}
              </Text>
            </Pressable>
          );
        })}

        <Text style={[styles.section, { color: p.tabIconDefault }]}>Mission plans (team + legacy)</Text>
        {combined.length === 0 ? (
          <Text style={{ color: p.tabIconDefault }}>No mission plans yet.</Text>
        ) : null}
        {combined.map((item) => {
          let title = "…";
          let sub = item.created_at;
          if (item.source === "ops") {
            if (decryptCandidates.length === 0) {
              title = "(need team key or vault)";
            } else {
              const j = tryDecryptUtf8WithKeys(item.encrypted_payload, OPS_AAD.mission_plan, decryptCandidates);
              title = j ? previewOpsRow("mission_plan", j) : "(cannot decrypt)";
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
              key={`${item.source}-${item.id}`}
              style={[styles.card, { borderColor: p.tabIconDefault }]}
              onPress={() => openRow(item)}>
              <Text style={{ color: p.text, fontWeight: "700" }}>{title}</Text>
              <Text style={{ color: p.tabIconDefault, fontSize: 12 }}>{sub}</Text>
            </Pressable>
          );
        })}

        <Pressable
          style={[styles.refreshLink, { borderColor: p.tabIconDefault }]}
          onPress={async () => {
            setRefreshing(true);
            await refresh();
            setRefreshing(false);
          }}>
          <Text style={{ color: p.tint, fontWeight: "700" }}>{refreshing ? "Refreshing…" : "Refresh lists"}</Text>
        </Pressable>
      </ScrollView>

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
      <OperationHubModal
        visible={showOpHubModal}
        onClose={() => setShowOpHubModal(false)}
        scheme={sch}
        supabase={supabase}
        profileId={profileId}
        username={username}
        mapKey={mapKey}
        onSaved={() => void refresh()}
      />
      <MissionPlanTeamModal
        visible={teamMission != null}
        onClose={() => setTeamMission(null)}
        headerTitle={teamMission?.headerTitle ?? ""}
        bodyText={teamMission?.bodyText ?? ""}
        opsReportId={teamMission?.opsReportId ?? null}
        supabase={supabase}
        profileId={profileId}
        username={username}
        mapKey={mapKey}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  lede: { fontSize: 12, lineHeight: 17, marginBottom: 16 },
  hint: { fontSize: 12, lineHeight: 17, marginBottom: 10, opacity: 0.9 },
  actionBtnPrimary: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  actionBtnTx: { fontWeight: "800", fontSize: 14 },
  actionBtnTxOutline: { fontWeight: "800", fontSize: 14 },
  refreshLink: {
    marginTop: 20,
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  section: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  card: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
});
