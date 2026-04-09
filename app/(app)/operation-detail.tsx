import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
    Alert,
    FlatList,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
    useColorScheme,
} from "react-native";

import { DocumentDetailModal } from "@/components/common/DocumentDetailModal";
import { AarModal } from "@/components/ops/AarModal";
import { IntelReportModal } from "@/components/ops/IntelReportModal";
import { MissionPlanModal } from "@/components/ops/MissionPlanModal";
import { SitrepModal } from "@/components/ops/SitrepModal";
import { TargetPackageModal } from "@/components/ops/TargetPackageModal";
import Colors from "@/constants/Colors";
import {
    OPERATION_HUB_AAD,
    OPS_AAD,
    OPS_TEAM_DECRYPT_HELP,
    formatAarForDisplay,
    formatDocKindLabel,
    formatIntelReportForDisplay,
    formatMissionForDisplay,
    formatSitrepForDisplay,
    formatTargetPackageForDisplay,
    previewOpsRow,
    tryDecryptUtf8WithKeys,
    type AarPayloadV1,
    type IntelReportPayloadV1,
    type MissionPlanPayloadV1,
    type OperationHubPayloadV1,
    type OpsDocKind,
    type SitrepPayloadV1,
    type TargetPackagePayloadV1,
} from "@/lib/opsReports";
import { collectOpsDecryptCandidates, resolveMapEncryptKey, useMMStore, type VaultMode } from "@/store/mmStore";

type HubRow = {
  id: string;
  encrypted_payload: string;
  created_at: string;
  author_username: string;
  author_id: string;
};

type ScopedOpsRow = {
  id: string;
  encrypted_payload: string;
  created_at: string;
  doc_kind: OpsDocKind;
  author_username: string;
  author_id: string;
};

type TabKey = "reports" | "brief";

export default function OperationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const opId = typeof id === "string" ? id : id?.[0] ?? "";
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const sch = scheme === "dark" ? "dark" : "light";
  const onTint = scheme === "dark" ? "#0f172a" : "#ffffff";

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

  const [tab, setTab] = useState<TabKey>("reports");
  const [hubRow, setHubRow] = useState<HubRow | null>(null);
  const [reports, setReports] = useState<ScopedOpsRow[]>([]);
  const [showMission, setShowMission] = useState(false);
  const [showSitrep, setShowSitrep] = useState(false);
  const [showAar, setShowAar] = useState(false);
  const [showTarget, setShowTarget] = useState(false);
  const [showIntel, setShowIntel] = useState(false);
  const [docDetail, setDocDetail] = useState<{
    title: string;
    body: string;
    subtitle: string;
    opsReportId?: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase || !opId) return;
    const { data: h, error: eh } = await supabase
      .from("operation_hubs")
      .select("id, encrypted_payload, created_at, author_username, author_id")
      .eq("id", opId)
      .maybeSingle();
    if (eh) {
      console.warn(eh.message);
      setHubRow(null);
    } else {
      setHubRow((h ?? null) as HubRow | null);
    }
    const { data: r, error: er } = await supabase
      .from("ops_reports")
      .select("id, encrypted_payload, created_at, doc_kind, author_username, author_id")
      .eq("operation_id", opId)
      .order("created_at", { ascending: false });
    if (er) {
      console.warn(er.message);
      setReports([]);
    } else {
      setReports((r ?? []) as ScopedOpsRow[]);
    }
  }, [supabase, opId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const hubTitle = useMemo(() => {
    if (!hubRow) return "Operation";
    if (decryptCandidates.length === 0) return "Operation";
    const json = tryDecryptUtf8WithKeys(hubRow.encrypted_payload, OPERATION_HUB_AAD, decryptCandidates);
    if (!json) return "(cannot decrypt)";
    try {
      const parsed = JSON.parse(json) as OperationHubPayloadV1;
      return parsed.title || "Operation";
    } catch {
      return "(cannot decrypt)";
    }
  }, [hubRow, decryptCandidates]);

  const openReport = (row: ScopedOpsRow) => {
    const ownReport = profileId != null && row.author_id === profileId;
    if (decryptCandidates.length === 0) {
      if (ownReport) {
        setDocDetail({
          title: "Cannot decrypt",
          body: OPS_TEAM_DECRYPT_HELP,
          subtitle: `${formatDocKindLabel(row.doc_kind)} · ${row.author_username} · ${row.created_at}`,
          opsReportId: row.id,
        });
        return;
      }
      Alert.alert("Reports", "No decrypt key available. Set a team key in Settings or unlock your vault.");
      return;
    }
    const aad = OPS_AAD[row.doc_kind];
    const json = tryDecryptUtf8WithKeys(row.encrypted_payload, aad, decryptCandidates);
    if (!json) {
      setDocDetail({
        title: "Cannot decrypt",
        body: OPS_TEAM_DECRYPT_HELP,
        subtitle: `${formatDocKindLabel(row.doc_kind)} · ${row.author_username} · ${row.created_at}`,
        opsReportId: ownReport ? row.id : undefined,
      });
      return;
    }
    try {
      let body = json;
      let displayTitle = previewOpsRow(row.doc_kind, json);
      if (row.doc_kind === "mission_plan") {
        const p = JSON.parse(json) as MissionPlanPayloadV1;
        displayTitle = p.title || displayTitle;
        body = formatMissionForDisplay(p);
      } else if (row.doc_kind === "sitrep") {
        body = formatSitrepForDisplay(JSON.parse(json) as SitrepPayloadV1);
      } else if (row.doc_kind === "aar") {
        body = formatAarForDisplay(JSON.parse(json) as AarPayloadV1);
      } else if (row.doc_kind === "target_package") {
        body = formatTargetPackageForDisplay(JSON.parse(json) as TargetPackagePayloadV1);
      } else if (row.doc_kind === "intel_report") {
        body = formatIntelReportForDisplay(JSON.parse(json) as IntelReportPayloadV1);
      }
      setDocDetail({
        title: displayTitle,
        body,
        subtitle: `${formatDocKindLabel(row.doc_kind)} · ${row.author_username} · ${row.created_at}`,
        opsReportId: ownReport ? row.id : undefined,
      });
    } catch {
      setDocDetail({
        title: "Cannot decrypt",
        body: OPS_TEAM_DECRYPT_HELP,
        subtitle: `${formatDocKindLabel(row.doc_kind)} · ${row.author_username} · ${row.created_at}`,
        opsReportId: ownReport ? row.id : undefined,
      });
    }
  };

  const deleteThisOperationHub = () => {
    if (!supabase || !profileId || !hubRow || hubRow.author_id !== profileId) return;
    Alert.alert(
      "Delete operation",
      "This removes the operation hub. Reports in the hub stay on the server but are no longer grouped here.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const { error: delErr } = await supabase.from("operation_hubs").delete().eq("id", opId);
            if (delErr) {
              Alert.alert("Operation", delErr.message);
              return;
            }
            router.back();
          },
        },
      ],
    );
  };

  if (!opId) {
    return (
      <View style={[styles.wrap, { backgroundColor: p.background }]}>
        <Text style={{ color: p.text }}>Missing operation id.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { backgroundColor: p.background }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <FontAwesome name="chevron-left" size={18} color={p.tint} />
          <Text style={[styles.backTx, { color: p.tint }]}>Missions</Text>
        </Pressable>
      </View>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.h1, { color: p.text }]}>{hubTitle}</Text>
          <Text style={[styles.sub, { color: p.tabIconDefault }]}>Scoped reports · {opId.slice(0, 8)}…</Text>
        </View>
        {hubRow && profileId && hubRow.author_id === profileId ? (
          <Pressable
            onPress={deleteThisOperationHub}
            hitSlop={10}
            style={({ pressed }) => [styles.hubDeleteBtn, { opacity: pressed ? 0.85 : 1 }]}>
            <Text style={styles.hubDeleteTx}>Delete hub</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.tabs}>
        <Pressable
          onPress={() => setTab("reports")}
          style={[
            styles.tab,
            tab === "reports" && { borderColor: p.tint, backgroundColor: sch === "dark" ? "#1e293b" : "#eff6ff" },
          ]}>
          <Text style={[styles.tabTx, { color: p.text }]}>Reports</Text>
        </Pressable>
        <Pressable
          onPress={() => setTab("brief")}
          style={[
            styles.tab,
            tab === "brief" && { borderColor: p.tint, backgroundColor: sch === "dark" ? "#1e293b" : "#eff6ff" },
          ]}>
          <Text style={[styles.tabTx, { color: p.text }]}>Brief / compose</Text>
        </Pressable>
      </View>

      {tab === "brief" ? (
        <ScrollView contentContainerStyle={styles.compose}>
          <Text style={[styles.composeHint, { color: p.tabIconDefault }]}>
            Forms save ciphertext to Supabase; plain text never leaves the device unencrypted.
          </Text>
          <View style={styles.actionGrid}>
            <Pressable
              style={[styles.bigBtn, { backgroundColor: p.tint }]}
              onPress={() => {
                if (!mapKey) Alert.alert("Operation", "Key unavailable.");
                else setShowMission(true);
              }}>
              <Text style={[styles.bigBtnTx, { color: onTint }]}>Mission plan</Text>
            </Pressable>
            <Pressable style={[styles.bigBtn, styles.outlineBtn, { borderColor: p.tint }]} onPress={() => setShowSitrep(true)}>
              <Text style={[styles.bigBtnTxOutline, { color: p.tint }]}>SITREP</Text>
            </Pressable>
            <Pressable style={[styles.bigBtn, styles.outlineBtn, { borderColor: p.tint }]} onPress={() => setShowAar(true)}>
              <Text style={[styles.bigBtnTxOutline, { color: p.tint }]}>AAR</Text>
            </Pressable>
            <Pressable style={[styles.bigBtn, styles.outlineBtn, { borderColor: p.tint }]} onPress={() => setShowTarget(true)}>
              <Text style={[styles.bigBtnTxOutline, { color: p.tint }]}>Target package</Text>
            </Pressable>
            <Pressable style={[styles.bigBtn, styles.outlineBtn, { borderColor: p.tint }]} onPress={() => setShowIntel(true)}>
              <Text style={[styles.bigBtnTxOutline, { color: p.tint }]}>Intel report</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={<Text style={{ color: p.tabIconDefault }}>No reports for this operation yet.</Text>}
          renderItem={({ item }) => {
            let headline: string = item.doc_kind;
            if (decryptCandidates.length > 0) {
              const j = tryDecryptUtf8WithKeys(item.encrypted_payload, OPS_AAD[item.doc_kind], decryptCandidates);
              headline = j ? previewOpsRow(item.doc_kind, j) : "(locked)";
            }
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${formatDocKindLabel(item.doc_kind)}: ${headline}`}
                style={[styles.card, { borderColor: p.tabIconDefault }]}
                onPress={() => openReport(item)}>
                <View style={styles.cardRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: p.text }]}>{headline}</Text>
                    <Text style={[styles.cardMeta, { color: p.tabIconDefault }]}>
                      {formatDocKindLabel(item.doc_kind)} · {item.author_username}
                    </Text>
                  </View>
                  <Text style={[styles.chevron, { color: p.tint }]}>›</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <DocumentDetailModal
        visible={docDetail != null}
        title={docDetail?.title ?? ""}
        subtitle={docDetail?.subtitle}
        body={docDetail?.body ?? ""}
        onClose={() => setDocDetail(null)}
        onDelete={
          docDetail?.opsReportId && supabase
            ? () => {
                const id = docDetail.opsReportId!;
                Alert.alert("Delete report", "Remove this report for everyone?", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                      const { error: delErr } = await supabase.from("ops_reports").delete().eq("id", id);
                      if (delErr) {
                        Alert.alert("Reports", delErr.message);
                        return;
                      }
                      setDocDetail(null);
                      void refresh();
                    },
                  },
                ]);
              }
            : undefined
        }
        deleteLabel="Delete my report"
      />

      <MissionPlanModal
        visible={showMission}
        onClose={() => setShowMission(false)}
        scheme={sch}
        supabase={supabase}
        profileId={profileId}
        username={username}
        mapKey={mapKey}
        operationId={opId}
        onSaved={() => void refresh()}
      />
      <SitrepModal
        visible={showSitrep}
        onClose={() => setShowSitrep(false)}
        scheme={sch}
        supabase={supabase}
        profileId={profileId}
        username={username}
        mapKey={mapKey}
        operationId={opId}
        onSaved={() => void refresh()}
      />
      <AarModal
        visible={showAar}
        onClose={() => setShowAar(false)}
        scheme={sch}
        supabase={supabase}
        profileId={profileId}
        username={username}
        mapKey={mapKey}
        operationId={opId}
        onSaved={() => void refresh()}
      />
      <TargetPackageModal
        visible={showTarget}
        onClose={() => setShowTarget(false)}
        scheme={sch}
        supabase={supabase}
        profileId={profileId}
        username={username}
        mapKey={mapKey}
        operationId={opId}
        onSaved={() => void refresh()}
      />
      <IntelReportModal
        visible={showIntel}
        onClose={() => setShowIntel(false)}
        scheme={sch}
        supabase={supabase}
        profileId={profileId}
        username={username}
        mapKey={mapKey}
        operationId={opId}
        onSaved={() => void refresh()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16 },
  topBar: { marginBottom: 8 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  backTx: { fontSize: 16, fontWeight: "700" },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 4 },
  hubDeleteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#b91c1c",
    alignSelf: "flex-start",
  },
  hubDeleteTx: { fontSize: 12, fontWeight: "800", color: "#b91c1c" },
  h1: { fontSize: 22, fontWeight: "800" },
  sub: { fontSize: 13, marginTop: 4, marginBottom: 12 },
  tabs: { flexDirection: "row", gap: 10, marginBottom: 12 },
  tab: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    borderColor: "transparent",
  },
  tabTx: { fontWeight: "700", fontSize: 14 },
  compose: { paddingBottom: 40 },
  composeHint: { fontSize: 12, lineHeight: 17, marginBottom: 14 },
  actionGrid: { gap: 10 },
  bigBtn: { paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  outlineBtn: { borderWidth: 2, backgroundColor: "transparent" },
  bigBtnTx: { fontSize: 15, fontWeight: "800" },
  bigBtnTxOutline: { fontSize: 15, fontWeight: "800" },
  card: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
  cardRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardTitle: { fontWeight: "700", fontSize: 15 },
  cardMeta: { fontSize: 12, marginTop: 4 },
  chevron: { fontSize: 26, fontWeight: "300", marginTop: -2 },
});
