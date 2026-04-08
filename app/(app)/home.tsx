import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Link } from "expo-router";
import { useWindowDimensions } from "react-native";

import { PanicButton } from "@/components/PanicButton";
import { TacticalCard } from "@/components/TacticalCard";
import type { MainTabRouteId } from "@/constants/mainTabs";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { useMMStore } from "@/store/mmStore";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export default function HomeScreen() {
  const username = useMMStore((s) => s.username);
  const tabBarOrder = useMMStore((s) => s.tabBarOrder);
  const reorderMainTabs = useMMStore((s) => s.reorderMainTabs);
  const { width } = useWindowDimensions();
  const gap = 12;
  const contentMax = 960;
  const gridInner = Math.min(width, contentMax) - 32;
  const cols = width >= 1180 ? 4 : width >= 840 ? 3 : 2;
  const cardBasis = Math.max(140, (gridInner - gap * (cols - 1)) / cols);

  const pinModuleTab = (id: MainTabRouteId) => {
    const head = tabBarOrder[0];
    void reorderMainTabs(id, head);
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, width >= 720 && styles.contentWide]}>
      <View style={styles.topTools}>
        <PanicButton variant="compact" />
        <Link href="/(app)/settings" asChild>
          <Pressable accessibilityRole="button" hitSlop={10}>
            <FontAwesome name="cog" size={22} color={TacticalPalette.boneMuted} />
          </Pressable>
        </Link>
      </View>
      <View style={styles.header}>
        <Text style={styles.kicker}>MM</Text>
        <Text style={styles.h1}>Operations hub</Text>
        <Text style={styles.sub}>
          {username ? `Signed in as ${username}` : "Secure session"} — choose a module.
        </Text>
        <Text style={styles.hubHint}>
          Web: drag a highlighted module onto the tab rail to reorder it (drop on a tab or empty rail). Long-press the same
          cards on mobile to pin that tab to the top of the rail.
        </Text>
      </View>

      <View style={styles.grid}>
        <View style={{ width: cardBasis, flexGrow: 1, maxWidth: "100%" as const }}>
          <TacticalCard
            title="Vault"
            subtitle="Encrypted drive — files and ops docs"
            detail="Files are encrypted on your device before upload (AES-GCM), and Supabase row-level security limits reads to your own account — we never see plaintext vault contents."
            href="/(app)/vault"
            tabBarDragId="vault"
            onPinToTabBar={() => pinModuleTab("vault")}
            icon={<FontAwesome name="lock" size={24} color={TacticalPalette.accent} />}
          />
        </View>
        <View style={{ width: cardBasis, flexGrow: 1, maxWidth: "100%" as const }}>
          <TacticalCard
            title="Signals"
            subtitle="Ciphers, OTP, compressor, stego"
            href="/(app)/signals"
            tabBarDragId="signals"
            onPinToTabBar={() => pinModuleTab("signals")}
            icon={<FontAwesome name="signal" size={24} color={TacticalPalette.accent} />}
          />
        </View>
        <View style={{ width: cardBasis, flexGrow: 1, maxWidth: "100%" as const }}>
          <TacticalCard
            title="Map & OSINT"
            subtitle="Tactical map, intel layers, E2EE pins"
            href="/(app)/map"
            tabBarDragId="map"
            onPinToTabBar={() => pinModuleTab("map")}
            icon={<FontAwesome name="map" size={24} color={TacticalPalette.accent} />}
          />
        </View>
        <View style={{ width: cardBasis, flexGrow: 1, maxWidth: "100%" as const }}>
          <TacticalCard
            title="Reports"
            subtitle="SITREP, AAR, target pkg, intel (rail tab)"
            href="/(app)/reports"
            tabBarDragId="reports"
            onPinToTabBar={() => pinModuleTab("reports")}
            icon={<FontAwesome name="file-text" size={24} color={TacticalPalette.accent} />}
          />
        </View>
        <View style={{ width: cardBasis, flexGrow: 1, maxWidth: "100%" as const }}>
          <TacticalCard
            title="Forensics"
            subtitle="Metadata, integrity, media scrub"
            href="/(app)/forensics"
            icon={<FontAwesome name="search" size={24} color={TacticalPalette.accent} />}
          />
        </View>
        <View style={{ width: cardBasis, flexGrow: 1, maxWidth: "100%" as const }}>
          <TacticalCard
            title="Missions"
            subtitle="Time-locked folders and reports"
            href="/(app)/missions"
            tabBarDragId="missions"
            onPinToTabBar={() => pinModuleTab("missions")}
            icon={<FontAwesome name="folder" size={24} color={TacticalPalette.accent} />}
          />
        </View>
        <View style={{ width: cardBasis, flexGrow: 1, maxWidth: "100%" as const }}>
          <TacticalCard
            title="Settings"
            subtitle="Security, panic, desktop layout"
            href="/(app)/settings"
            tabBarDragId="settings"
            onPinToTabBar={() => pinModuleTab("settings")}
            icon={<FontAwesome name="cog" size={24} color={TacticalPalette.accent} />}
          />
        </View>
        <View style={{ width: cardBasis, flexGrow: 1, maxWidth: "100%" as const }}>
          <TacticalCard
            title="Good Palantir"
            subtitle="Open external dashboard (new tab)"
            externalUrl="https://good-palantir.vercel.app"
            icon={<FontAwesome name="globe" size={24} color={TacticalPalette.coyote} />}
          />
        </View>
        <View style={{ width: cardBasis, flexGrow: 1, maxWidth: "100%" as const }}>
          <TacticalCard
            title="Bulletin"
            subtitle="Encrypted team announcements"
            href="/(app)/bulletin"
            icon={<FontAwesome name="bullhorn" size={24} color={TacticalPalette.accent} />}
          />
        </View>
        <View style={{ width: cardBasis, flexGrow: 1, maxWidth: "100%" as const }}>
          <TacticalCard
            title="Gear / logistics"
            subtitle="Typed loadouts — vehicles, kit, sustainment…"
            href="/(app)/gear"
            icon={<FontAwesome name="suitcase" size={24} color={TacticalPalette.accent} />}
          />
        </View>
        <View style={{ width: cardBasis, flexGrow: 1, maxWidth: "100%" as const }}>
          <TacticalCard
            title="Team GPX"
            subtitle="Export map pins & routes for other apps"
            href="/(app)/map-exports"
            icon={<FontAwesome name="download" size={24} color={TacticalPalette.accent} />}
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: TacticalPalette.matteBlack,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    maxWidth: 960,
    alignSelf: "center",
    width: "100%",
  },
  contentWide: {
    paddingHorizontal: 24,
  },
  topTools: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 14,
    marginBottom: 8,
  },
  header: {
    marginBottom: 24,
  },
  kicker: {
    color: TacticalPalette.coyote,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "700",
    marginBottom: 6,
  },
  h1: {
    color: TacticalPalette.bone,
    fontSize: 26,
    fontWeight: "700",
  },
  sub: {
    color: TacticalPalette.boneMuted,
    fontSize: 14,
    marginTop: 8,
    lineHeight: 20,
  },
  hubHint: {
    color: TacticalPalette.coyote,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 12,
    opacity: 0.95,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    gap: 12,
    alignItems: "stretch",
  },
});
