import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { TacticalClockBadge } from "@/components/chrome/TacticalClockBadge";
import { LiveCommsPanel } from "@/components/comms/LiveCommsPanel";
import { MMTabBar } from "@/components/navigation/MMTabBar";
import { OpsScreeningGate } from "@/components/ops/OpsScreeningGate";
import { ScorchedEarthListener } from "@/components/ScorchedEarthListener";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { useActivityOutboxFlush } from "@/hooks/useActivityOutboxFlush";
import { useDeadManMonitor } from "@/hooks/useDeadManMonitor";
import { useTacticalChrome } from "@/hooks/useTacticalChrome";
import { useMMStore } from "@/store/mmStore";

function TabIcon(props: { name: ComponentProps<typeof FontAwesome>["name"]; color: string }) {
  return <FontAwesome size={26} style={{ marginBottom: -2 }} {...props} />;
}

export default function AppLayout() {
  const desktopMode = useMMStore((s) => s.desktopMode);
  const tabRailWidthPx = useMMStore((s) => s.tabRailWidthPx);
  const tabRailHeightPx = useMMStore((s) => s.tabRailHeightPx);
  useDeadManMonitor();
  useActivityOutboxFlush();

  const isWebDesk = Platform.OS === "web" && desktopMode;
  const theme = useTacticalChrome();
  const [commsSheetOpen, setCommsSheetOpen] = useState(false);
  const COMM_RAIL_W = 320;

  return (
    <View style={styles.shell}>
      <ScorchedEarthListener />
      <OpsScreeningGate />
      <View style={styles.mainRow}>
        <View style={styles.tabsColumn}>
      <Tabs
        tabBar={(props) => <MMTabBar {...props} />}
        screenOptions={{
          tabBarActiveTintColor: theme.tint,
          tabBarInactiveTintColor: theme.tabIconDefault,
          headerShown: false,
          tabBarStyle: isWebDesk
            ? {
                width: tabRailWidthPx,
                maxWidth: tabRailWidthPx,
                minWidth: tabRailWidthPx,
                flexGrow: 0,
                flexShrink: 0,
                alignSelf: "stretch",
                backgroundColor: theme.background,
                elevation: 0,
              }
            : {
                height: tabRailHeightPx,
                minHeight: tabRailHeightPx,
                maxHeight: tabRailHeightPx,
                flexGrow: 0,
                flexShrink: 0,
                backgroundColor: theme.background,
                elevation: 0,
              },
          ...(isWebDesk
            ? {
                tabBarPosition: "left" as const,
                tabBarVariant: "material" as const,
                tabBarShowLabel: true,
              }
            : {}),
        }}>
        <Tabs.Screen
          name="home"
          options={{
            title: "Home",
            tabBarIcon: ({ color }) => <TabIcon name="home" color={color} />,
          }}
        />
        <Tabs.Screen
          name="vault"
          options={{
            title: "Vault",
            tabBarIcon: ({ color }) => <TabIcon name="lock" color={color} />,
          }}
        />
        <Tabs.Screen
          name="signals"
          options={{
            title: "Ciphers",
            tabBarIcon: ({ color }) => <TabIcon name="signal" color={color} />,
          }}
        />
        <Tabs.Screen
          name="forensics"
          options={{
            title: "Forensics",
            href: null,
          }}
        />
        <Tabs.Screen
          name="bulletin"
          options={{
            title: "Bulletin",
            href: null,
          }}
        />
        <Tabs.Screen
          name="gear"
          options={{
            title: "Gear",
            href: null,
          }}
        />
        <Tabs.Screen
          name="map-exports"
          options={{
            title: "GPX exports",
            href: null,
          }}
        />
        <Tabs.Screen
          name="sand-table"
          options={{
            title: "Sand Table",
            href: null,
          }}
        />
        <Tabs.Screen
          name="operation-detail"
          options={{
            title: "Operation",
            href: null,
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: "Map",
            tabBarIcon: ({ color }) => <TabIcon name="map" color={color} />,
          }}
        />
        <Tabs.Screen
          name="reports"
          options={{
            title: "Reports",
            tabBarIcon: ({ color }) => <TabIcon name="file-text" color={color} />,
          }}
        />
        <Tabs.Screen
          name="missions"
          options={{
            title: "Missions",
            tabBarIcon: ({ color }) => <TabIcon name="folder" color={color} />,
          }}
        />
        <Tabs.Screen
          name="calendar"
          options={{
            title: "Calendar",
            tabBarIcon: ({ color }) => <TabIcon name="calendar" color={color} />,
          }}
        />
        <Tabs.Screen
          name="activity"
          options={{
            title: "Activity",
            tabBarIcon: ({ color }) => <TabIcon name="history" color={color} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: "Settings",
            tabBarIcon: ({ color }) => <TabIcon name="cog" color={color} />,
          }}
        />
      </Tabs>
      <TacticalClockBadge />
        </View>

        {Platform.OS === "web" && isWebDesk ? (
          <View
            style={{
              width: COMM_RAIL_W,
              flexShrink: 0,
              borderLeftWidth: StyleSheet.hairlineWidth,
              borderLeftColor: theme.border,
              backgroundColor: TacticalPalette.matteBlack,
            }}>
            <LiveCommsPanel variant="trailing" />
          </View>
        ) : null}
      </View>

      {Platform.OS === "web" && !isWebDesk ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open encrypted live comms"
            onPress={() => setCommsSheetOpen(true)}
            style={({ pressed }) => [
              styles.commsFab,
              {
                backgroundColor: theme.tint,
                opacity: pressed ? 0.9 : 1,
              },
            ]}>
            <FontAwesome name="comments" size={20} color={TacticalPalette.matteBlack} />
            <Text style={styles.commsFabTx}>Comms</Text>
          </Pressable>
          <Modal
            visible={commsSheetOpen}
            animationType="slide"
            presentationStyle="fullScreen"
            onRequestClose={() => setCommsSheetOpen(false)}>
            <View style={{ flex: 1, backgroundColor: TacticalPalette.matteBlack }}>
              <LiveCommsPanel variant="sheet" onCloseSheet={() => setCommsSheetOpen(false)} />
            </View>
          </Modal>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  mainRow: { flex: 1, flexDirection: "row", minWidth: 0 },
  tabsColumn: { flex: 1, minWidth: 0 },
  commsFab: {
    position: "absolute",
    right: 16,
    bottom: 88,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    elevation: 8,
    zIndex: 50,
    ...(Platform.OS === "web" ? { boxShadow: "0 4px 14px rgba(0,0,0,0.35)" } : {}),
  },
  commsFabTx: { fontWeight: "900", fontSize: 14, color: TacticalPalette.matteBlack },
});
