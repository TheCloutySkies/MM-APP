import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from "react-native";

import { InfoHint } from "@/components/chrome/InfoHint";
import { AarModal } from "@/components/ops/AarModal";
import { IntelReportModal } from "@/components/ops/IntelReportModal";
import { MedevacNineLineModal } from "@/components/ops/MedevacNineLineModal";
import { RouteReconModal } from "@/components/ops/RouteReconModal";
import { SitrepModal } from "@/components/ops/SitrepModal";
import { SpotrepModal } from "@/components/ops/SpotrepModal";
import { TargetPackageModal } from "@/components/ops/TargetPackageModal";
import { TacticalBlock } from "@/components/shell/TacticalBlock";
import Colors from "@/constants/Colors";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { resolveMapEncryptKey, useMMStore, type VaultMode } from "@/store/mmStore";

export default function ReportsScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const sch = scheme === "dark" ? "dark" : "light";

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

  const [showSitrepModal, setShowSitrepModal] = useState(false);
  const [showAarModal, setShowAarModal] = useState(false);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [showIntelModal, setShowIntelModal] = useState(false);
  const [showSpotrepModal, setShowSpotrepModal] = useState(false);
  const [showMedevacModal, setShowMedevacModal] = useState(false);
  const [showRouteReconModal, setShowRouteReconModal] = useState(false);

  const needKey = () => {
    Alert.alert("Reports", "Encryption key unavailable. Unlock vault or set shared map key.");
  };

  return (
    <View style={[styles.wrap, { backgroundColor: p.background }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.kicker, { color: p.tabIconDefault }]}>FIELD REPORTS</Text>
        <View style={styles.ledeRow}>
          <Text style={[styles.lede, { color: p.text, flex: 1 }]}>
            Encrypted SITREPs, AARs, target packages, and intel. Open <Text style={{ fontWeight: "700" }}>Missions</Text>{" "}
            to tie a report to an operation.
          </Text>
          <InfoHint
            title="Field reports"
            webTitle="Reports use your team ops key after the vault is unlocked."
            message="Payloads are encrypted client-side with the shared operations key (same family as map tools). Unlock the vault on this device before filing. Longer explanations and classification reminders live in each form."
            tint={p.tabIconDefault}
          />
        </View>

        {/*
          Avoid `Link` + `asChild` here: RN Web forwards merged styles onto a real `<a>`, and values like
          `gap` / flex arrays can hit "Indexed property setter is not supported" on CSSStyleDeclaration.
        */}
        <Pressable
          onPress={() => router.push("/(app)/missions")}
          accessibilityRole="button"
          accessibilityLabel="Open missions and operations">
          <View
            style={[styles.missionsLink, { borderColor: p.tint, backgroundColor: TacticalPalette.elevated }]}>
            <FontAwesome name="folder-open" size={18} color={p.tint} />
            <Text style={[styles.missionsLinkTx, { color: p.tint }]}>Operations & mission plans</Text>
            <FontAwesome name="chevron-right" size={12} color={p.tabIconDefault} />
          </View>
        </Pressable>

        <TacticalBlock title="Immediate & tactical" defaultOpen>
          <View style={styles.reportRow}>
            <Pressable
              style={[styles.reportChip, { borderColor: p.tint }]}
              onPress={() => (mapKey ? setShowSpotrepModal(true) : needKey())}>
              <Text style={[styles.chipTx, { color: p.tint }]}>SPOTREP</Text>
            </Pressable>
            <Pressable
              style={[styles.reportChip, { borderColor: p.tint }]}
              onPress={() => (mapKey ? setShowMedevacModal(true) : needKey())}>
              <Text style={[styles.chipTx, { color: p.tint }]}>9-line MED</Text>
            </Pressable>
            <Pressable
              style={[styles.reportChip, { borderColor: p.tint }]}
              onPress={() => (mapKey ? setShowRouteReconModal(true) : needKey())}>
              <Text style={[styles.chipTx, { color: p.tint }]}>Route recon</Text>
            </Pressable>
          </View>
        </TacticalBlock>

        <TacticalBlock title="New report" defaultOpen>
          <View style={styles.reportRow}>
            <Pressable
              style={[styles.reportChip, { borderColor: p.tint }]}
              onPress={() => (mapKey ? setShowSitrepModal(true) : needKey())}>
              <Text style={[styles.chipTx, { color: p.tint }]}>SITREP</Text>
            </Pressable>
            <Pressable
              style={[styles.reportChip, { borderColor: p.tint }]}
              onPress={() => (mapKey ? setShowAarModal(true) : needKey())}>
              <Text style={[styles.chipTx, { color: p.tint }]}>AAR</Text>
            </Pressable>
            <Pressable
              style={[styles.reportChip, { borderColor: p.tint }]}
              onPress={() => (mapKey ? setShowTargetModal(true) : needKey())}>
              <Text style={[styles.chipTx, { color: p.tint }]}>Target pkg</Text>
            </Pressable>
            <Pressable
              style={[styles.reportChip, { borderColor: p.tint }]}
              onPress={() => (mapKey ? setShowIntelModal(true) : needKey())}>
              <Text style={[styles.chipTx, { color: p.tint }]}>Intel</Text>
            </Pressable>
          </View>
        </TacticalBlock>

        <Pressable
          onPress={() => router.push("/(app)/sand-table")}
          accessibilityRole="button"
          accessibilityLabel="Open Sand Table route creator overview"
          style={{ marginTop: 8 }}>
          <View style={[styles.missionsLink, { borderColor: TacticalPalette.accent, backgroundColor: TacticalPalette.elevated }]}>
            <FontAwesome name="picture-o" size={18} color={TacticalPalette.accent} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.missionsLinkTx, { color: TacticalPalette.accent }]}>Sand Table Route Creator</Text>
              <Text style={{ color: p.tabIconDefault, fontSize: 12, marginTop: 4, lineHeight: 17 }}>
                Isolated fullscreen Sand Table on web (separate Leaflet from the global map). From Route recon you can export
                encrypted GeoJSON + PNG into the report payload.
              </Text>
            </View>
            <FontAwesome name="chevron-right" size={12} color={p.tabIconDefault} />
          </View>
        </Pressable>
      </ScrollView>

      <SitrepModal
        visible={showSitrepModal}
        onClose={() => setShowSitrepModal(false)}
        scheme={sch}
        supabase={supabase}
        profileId={profileId}
        username={username}
        mapKey={mapKey}
        onSaved={() => {}}
      />
      <AarModal
        visible={showAarModal}
        onClose={() => setShowAarModal(false)}
        scheme={sch}
        supabase={supabase}
        profileId={profileId}
        username={username}
        mapKey={mapKey}
        onSaved={() => {}}
      />
      <TargetPackageModal
        visible={showTargetModal}
        onClose={() => setShowTargetModal(false)}
        scheme={sch}
        supabase={supabase}
        profileId={profileId}
        username={username}
        mapKey={mapKey}
        onSaved={() => {}}
      />
      <IntelReportModal
        visible={showIntelModal}
        onClose={() => setShowIntelModal(false)}
        scheme={sch}
        supabase={supabase}
        profileId={profileId}
        username={username}
        mapKey={mapKey}
        onSaved={() => {}}
      />
      <SpotrepModal
        visible={showSpotrepModal}
        onClose={() => setShowSpotrepModal(false)}
        scheme={sch}
        supabase={supabase}
        profileId={profileId}
        username={username}
        mapKey={mapKey}
        onSaved={() => {}}
      />
      <MedevacNineLineModal
        visible={showMedevacModal}
        onClose={() => setShowMedevacModal(false)}
        scheme={sch}
        supabase={supabase}
        profileId={profileId}
        username={username}
        mapKey={mapKey}
        onSaved={() => {}}
      />
      <RouteReconModal
        visible={showRouteReconModal}
        onClose={() => setShowRouteReconModal(false)}
        scheme={sch}
        supabase={supabase}
        profileId={profileId}
        username={username}
        mapKey={mapKey}
        onSaved={() => {}}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  kicker: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  ledeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 16,
  },
  lede: { fontSize: 14, lineHeight: 21 },
  missionsLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 20,
  },
  missionsLinkTx: { flex: 1, fontSize: 15, fontWeight: "700" },
  reportRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  reportChip: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 100,
    alignItems: "center",
  },
  chipTx: { fontWeight: "800", fontSize: 14 },
});
