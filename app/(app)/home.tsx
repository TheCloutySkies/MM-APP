import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Link } from "expo-router";
import { useState } from "react";
import { useWindowDimensions } from "react-native";

import { GoodPalantirWindow } from "@/components/GoodPalantirWindow";
import { PanicButton } from "@/components/PanicButton";
import { TacticalCard } from "@/components/TacticalCard";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { useMMStore } from "@/store/mmStore";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export default function HomeScreen() {
  const username = useMMStore((s) => s.username);
  const [palantirOpen, setPalantirOpen] = useState(false);
  const { width } = useWindowDimensions();
  const isWide = width >= 720;
  const gap = 12;
  const cardBasis = isWide ? (width - 48 - gap) / 2 : width - 32;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, isWide && styles.contentWide]}>
      <GoodPalantirWindow visible={palantirOpen} onClose={() => setPalantirOpen(false)} />
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
      </View>

      <View style={[styles.grid, isWide && styles.gridWide]}>
        <View style={{ width: cardBasis }}>
          <TacticalCard
            title="Vault"
            subtitle="Encrypted drive — files and ops docs"
            href="/(app)/vault"
            icon={<FontAwesome name="lock" size={24} color={TacticalPalette.accent} />}
          />
        </View>
        <View style={{ width: cardBasis }}>
          <TacticalCard
            title="Map & OSINT"
            subtitle="Tactical map, intel layers, E2EE pins"
            href="/(app)/map"
            icon={<FontAwesome name="map" size={24} color={TacticalPalette.accent} />}
          />
        </View>
        <View style={{ width: cardBasis }}>
          <TacticalCard
            title="Forensics"
            subtitle="Metadata, integrity, media scrub"
            href="/(app)/forensics"
            icon={<FontAwesome name="search" size={24} color={TacticalPalette.accent} />}
          />
        </View>
        <View style={{ width: cardBasis }}>
          <TacticalCard
            title="Missions"
            subtitle="Time-locked folders and reports"
            href="/(app)/missions"
            icon={<FontAwesome name="folder" size={24} color={TacticalPalette.accent} />}
          />
        </View>
        <View style={{ width: cardBasis }}>
          <TacticalCard
            title="Settings"
            subtitle="Security, panic, desktop layout"
            href="/(app)/settings"
            icon={<FontAwesome name="cog" size={24} color={TacticalPalette.accent} />}
          />
        </View>
        <View style={{ width: cardBasis }}>
          <TacticalCard
            title="Good Palantir"
            subtitle="Floating embed on web · launch external if host blocks iframes"
            onCustomPress={() => setPalantirOpen(true)}
            icon={<FontAwesome name="globe" size={24} color={TacticalPalette.coyote} />}
          />
        </View>
        <View style={{ width: cardBasis }}>
          <TacticalCard
            title="Bulletin"
            subtitle="Encrypted team announcements"
            href="/(app)/bulletin"
            icon={<FontAwesome name="bullhorn" size={24} color={TacticalPalette.accent} />}
          />
        </View>
        <View style={{ width: cardBasis }}>
          <TacticalCard
            title="Gear / logistics"
            subtitle="Line 1–3 loadouts (E2EE)"
            href="/(app)/gear"
            icon={<FontAwesome name="suitcase" size={24} color={TacticalPalette.accent} />}
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
  grid: {
    flexDirection: "column",
    gap: 12,
    alignItems: "stretch",
  },
  gridWide: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    gap: 12,
  },
});
