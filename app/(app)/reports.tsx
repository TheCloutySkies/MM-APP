import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text as RNText, useColorScheme, View } from "react-native";
import { Card, Chip, Text } from "react-native-paper";

import { InfoHint } from "@/components/chrome/InfoHint";
import { AarModal } from "@/components/ops/AarModal";
import { IntelReportModal } from "@/components/ops/IntelReportModal";
import { MedevacNineLineModal } from "@/components/ops/MedevacNineLineModal";
import { RouteReconModal } from "@/components/ops/RouteReconModal";
import { SitrepModal } from "@/components/ops/SitrepModal";
import { SpotrepModal } from "@/components/ops/SpotrepModal";
import { TargetPackageModal } from "@/components/ops/TargetPackageModal";
import { TacticalBlock } from "@/components/shell/TacticalBlock";
import { useTacticalChrome } from "@/hooks/useTacticalChrome";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { hexToBytes } from "@/lib/crypto/bytes";
import { getMapSharedKeyHex } from "@/lib/env";
import { resolveMapEncryptKey, useMMStore, type VaultMode } from "@/store/mmStore";

export default function ReportsScreen() {
  const router = useRouter();
  const chrome = useTacticalChrome();
  const scheme = useColorScheme() ?? "light";
  const sch = scheme === "dark" ? "dark" : "light";

  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);
  const username = useMMStore((s) => s.username);
  const vaultMode = useMMStore((s) => s.vaultMode) as VaultMode | null;

  const mapKey = useMemo(() => {
    const hex = resolveMapEncryptKey() ?? getMapSharedKeyHex();
    if (!hex || hex.length !== 64) return null;
    try {
      return hexToBytes(hex);
    } catch {
      return null;
    }
  }, [vaultMode]);

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
    <View style={[styles.wrap, { backgroundColor: chrome.background }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text variant="labelLarge" style={[styles.kicker, { color: chrome.textMuted }]}>
          FIELD REPORTS
        </Text>
        <View style={styles.ledeRow}>
          <RNText style={[styles.lede, { color: chrome.text, flex: 1 }]}>
            Encrypted SITREPs, AARs, target packages, and intel. Open <RNText style={{ fontWeight: "700" }}>Missions</RNText> to tie
            a report to an operation.
          </RNText>
          <InfoHint
            title="Field reports"
            webTitle="Reports use your team ops key after the vault is unlocked."
            message="Payloads are encrypted client-side with the shared operations key (same family as map tools). Unlock the vault on this device before filing. Longer explanations and classification reminders live in each form."
            tint={chrome.textMuted}
          />
        </View>

        {/*
          Avoid `Link` + `asChild` here: RN Web forwards merged styles onto a real `<a>`, and values like
          `gap` / flex arrays can hit "Indexed property setter is not supported" on CSSStyleDeclaration.
        */}
        <Card
          mode="elevated"
          style={[styles.linkCard, { borderColor: chrome.accent }]}
          onPress={() => router.push("/(app)/missions")}>
          <Card.Title
            title="Operations & mission plans"
            titleStyle={{ color: chrome.accent, fontSize: 15 }}
            left={() => <FontAwesome name="folder-open" size={18} color={chrome.accent} style={{ marginLeft: 12 }} />}
            right={() => <FontAwesome name="chevron-right" size={12} color={chrome.textMuted} style={{ marginRight: 12 }} />}
          />
        </Card>

        <TacticalBlock title="Immediate & tactical" defaultOpen>
          <View style={styles.reportRow}>
            <Chip
              mode="outlined"
              selectedColor={chrome.accent}
              textStyle={[styles.chipLabel, { color: chrome.accent }]}
              style={styles.chip}
              onPress={() => (mapKey ? setShowSpotrepModal(true) : needKey())}>
              SPOTREP
            </Chip>
            <Chip
              mode="outlined"
              selectedColor={chrome.accent}
              textStyle={[styles.chipLabel, { color: chrome.accent }]}
              style={styles.chip}
              onPress={() => (mapKey ? setShowMedevacModal(true) : needKey())}>
              9-line MED
            </Chip>
            <Chip
              mode="outlined"
              selectedColor={chrome.accent}
              textStyle={[styles.chipLabel, { color: chrome.accent }]}
              style={styles.chip}
              onPress={() => (mapKey ? setShowRouteReconModal(true) : needKey())}>
              Route recon
            </Chip>
          </View>
        </TacticalBlock>

        <TacticalBlock title="New report" defaultOpen>
          <View style={styles.reportRow}>
            <Chip
              mode="outlined"
              selectedColor={chrome.accent}
              textStyle={[styles.chipLabel, { color: chrome.accent }]}
              style={styles.chip}
              onPress={() => (mapKey ? setShowSitrepModal(true) : needKey())}>
              SITREP
            </Chip>
            <Chip
              mode="outlined"
              selectedColor={chrome.accent}
              textStyle={[styles.chipLabel, { color: chrome.accent }]}
              style={styles.chip}
              onPress={() => (mapKey ? setShowAarModal(true) : needKey())}>
              AAR
            </Chip>
            <Chip
              mode="outlined"
              selectedColor={chrome.accent}
              textStyle={[styles.chipLabel, { color: chrome.accent }]}
              style={styles.chip}
              onPress={() => (mapKey ? setShowTargetModal(true) : needKey())}>
              Target pkg
            </Chip>
            <Chip
              mode="outlined"
              selectedColor={chrome.accent}
              textStyle={[styles.chipLabel, { color: chrome.accent }]}
              style={styles.chip}
              onPress={() => (mapKey ? setShowIntelModal(true) : needKey())}>
              Intel
            </Chip>
          </View>
        </TacticalBlock>

        <Card
          mode="elevated"
          style={[styles.linkCard, styles.sandCard, { borderColor: TacticalPalette.accent }]}
          onPress={() => router.push("/(app)/sand-table")}>
          <Card.Title
            title="Sand Table Route Creator"
            titleStyle={{ color: TacticalPalette.accent, fontSize: 15 }}
            subtitle="Isolated fullscreen Sand Table on web (separate Leaflet from the global map). From Route recon you can export encrypted GeoJSON + PNG into the report payload."
            subtitleNumberOfLines={4}
            subtitleStyle={{ color: chrome.textMuted, fontSize: 12, lineHeight: 17 }}
            left={() => (
              <FontAwesome name="picture-o" size={18} color={TacticalPalette.accent} style={{ marginLeft: 12 }} />
            )}
            right={() => <FontAwesome name="chevron-right" size={12} color={chrome.textMuted} style={{ marginRight: 12 }} />}
          />
        </Card>
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
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  ledeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 16,
  },
  lede: { lineHeight: 21 },
  linkCard: {
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 20,
    backgroundColor: TacticalPalette.elevated,
  },
  sandCard: { marginTop: 8 },
  reportRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: { borderColor: TacticalPalette.border },
  chipLabel: { fontWeight: "800", fontSize: 14 },
});
