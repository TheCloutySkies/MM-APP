import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from "react-native";

import { AarModal } from "@/components/ops/AarModal";
import { IntelReportModal } from "@/components/ops/IntelReportModal";
import { SitrepModal } from "@/components/ops/SitrepModal";
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

  const needKey = () => {
    Alert.alert("Reports", "Encryption key unavailable. Unlock vault or set shared map key.");
  };

  return (
    <View style={[styles.wrap, { backgroundColor: p.background }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.kicker, { color: p.tabIconDefault }]}>FIELD REPORTS</Text>
        <Text style={[styles.lede, { color: p.text }]}>
          File SITREPs, AARs, target packages, and intel reports. Tie them to an operation from{" "}
          <Text style={{ fontWeight: "700" }}>Missions</Text> or an operation dashboard so everything lands in one place.
        </Text>

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
  lede: { fontSize: 14, lineHeight: 21, marginBottom: 16 },
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
