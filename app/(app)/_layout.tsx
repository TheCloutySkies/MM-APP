import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { TacticalClockBadge } from "@/components/chrome/TacticalClockBadge";
import { LiveCommsPanel } from "@/components/comms/LiveCommsPanel";
import { LiveSocketProvider } from "@/components/comms/LiveSocketProvider";
import { MMTabBar } from "@/components/navigation/MMTabBar";
import { OpsScreeningGate } from "@/components/ops/OpsScreeningGate";
import { ScorchedEarthListener } from "@/components/ScorchedEarthListener";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { useActivityOutboxFlush } from "@/hooks/useActivityOutboxFlush";
import { useDeadManMonitor } from "@/hooks/useDeadManMonitor";
import { useTacticalChrome } from "@/hooks/useTacticalChrome";
import { useVaultOutboxFlush } from "@/hooks/useVaultOutboxFlush";
import { useMMStore } from "@/store/mmStore";

const DESK_COMMS_FAB_W = 120;
const DESK_COMMS_FAB_H = 46;
const DESK_COMMS_FAB_POS_KEY = "mm_desk_comms_fab_pos_v1";

function readDeskCommsFabPos(): { x: number; y: number } | null {
  if (Platform.OS !== "web" || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(DESK_COMMS_FAB_POS_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof j.x !== "number" || typeof j.y !== "number") return null;
    return { x: j.x, y: j.y };
  } catch {
    return null;
  }
}

function writeDeskCommsFabPos(p: { x: number; y: number }) {
  if (Platform.OS !== "web" || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(DESK_COMMS_FAB_POS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

type DeskFabProps = {
  tint: string;
  onOpen: () => void;
};

function clampDeskFabPos(p: { x: number; y: number }) {
  const { width: W, height: H } = Dimensions.get("window");
  const x = Math.min(Math.max(8, p.x), Math.max(8, W - DESK_COMMS_FAB_W - 8));
  const y = Math.min(Math.max(8, p.y), Math.max(8, H - DESK_COMMS_FAB_H - 8));
  return { x, y };
}

function defaultDeskFabPos() {
  const { width: W, height: H } = Dimensions.get("window");
  return { x: W - DESK_COMMS_FAB_W - 12, y: H / 2 - DESK_COMMS_FAB_H / 2 };
}

/** Draggable “Comms” bubble when the desktop rail is collapsed; position persists in sessionStorage. */
function DraggableDeskCommsFab({ tint, onOpen }: DeskFabProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const posRef = useRef<{ x: number; y: number } | null>(null);
  const gesture = useRef({
    pageX: 0,
    pageY: 0,
    ox: 0,
    oy: 0,
    moved: false,
  });

  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  useEffect(() => {
    const p = readDeskCommsFabPos();
    if (p) {
      const c = clampDeskFabPos(p);
      setPos(c);
      posRef.current = c;
    }
  }, []);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
        onPanResponderGrant: (e) => {
          gesture.current.moved = false;
          const origin = posRef.current ?? defaultDeskFabPos();
          gesture.current.pageX = e.nativeEvent.pageX;
          gesture.current.pageY = e.nativeEvent.pageY;
          gesture.current.ox = origin.x;
          gesture.current.oy = origin.y;
          if (!posRef.current) {
            const init = clampDeskFabPos(origin);
            setPos(init);
            posRef.current = init;
          }
        },
        onPanResponderMove: (e) => {
          const dx = e.nativeEvent.pageX - gesture.current.pageX;
          const dy = e.nativeEvent.pageY - gesture.current.pageY;
          if (Math.abs(dx) > 4 || Math.abs(dy) > 4) gesture.current.moved = true;
          const next = clampDeskFabPos({
            x: gesture.current.ox + dx,
            y: gesture.current.oy + dy,
          });
          setPos(next);
          posRef.current = next;
        },
        onPanResponderRelease: () => {
          if (!gesture.current.moved) {
            onOpen();
            return;
          }
          const cur = posRef.current;
          if (cur) {
            const c = clampDeskFabPos(cur);
            setPos(c);
            posRef.current = c;
            writeDeskCommsFabPos(c);
          }
        },
      }),
    [onOpen],
  );

  const fabOuterStyle = pos
    ? [styles.deskCommsFabAbsolute, { left: pos.x, top: pos.y }]
    : [styles.deskCommsFabAbsolute, styles.deskCommsFabDefaultSlot];

  return (
    <View
      {...pan.panHandlers}
      style={fabOuterStyle}
      accessibilityRole="button"
      accessibilityLabel="Open team chat"
      accessibilityHint="Drag to move. Release without dragging to open.">
      <View style={[styles.deskCommsFabInner, { backgroundColor: tint }]}>
        <FontAwesome name="comments" size={20} color={TacticalPalette.matteBlack} />
        <Text style={styles.deskCommsFabTx}>Comms</Text>
      </View>
    </View>
  );
}

function TabIcon(props: { name: ComponentProps<typeof FontAwesome>["name"]; color: string }) {
  return <FontAwesome size={26} style={{ marginBottom: -2 }} {...props} />;
}

export default function AppLayout() {
  const desktopMode = useMMStore((s) => s.desktopMode);
  const tabRailWidthPx = useMMStore((s) => s.tabRailWidthPx);
  const tabRailHeightPx = useMMStore((s) => s.tabRailHeightPx);
  useDeadManMonitor();
  useActivityOutboxFlush();
  useVaultOutboxFlush();

  const isWebDesk = Platform.OS === "web" && desktopMode;
  const theme = useTacticalChrome();
  const [commsSheetOpen, setCommsSheetOpen] = useState(false);
  /** Desktop trailing comms: user can collapse the rail to a floating bubble (same idea as mobile FAB). */
  const [deskCommsOpen, setDeskCommsOpen] = useState(true);
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
          deskCommsOpen ? (
            <View
              style={{
                width: COMM_RAIL_W,
                flexShrink: 0,
                borderLeftWidth: StyleSheet.hairlineWidth,
                borderLeftColor: theme.border,
                backgroundColor: TacticalPalette.matteBlack,
              }}>
              <LiveCommsPanel variant="trailing" onCollapseTrailing={() => setDeskCommsOpen(false)} />
            </View>
          ) : (
            <DraggableDeskCommsFab tint={theme.tint} onOpen={() => setDeskCommsOpen(true)} />
          )
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
    </LiveSocketProvider>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  mainRow: {
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
    ...(Platform.OS === "web" ? { position: "relative" as const } : {}),
  },
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
  deskCommsFabAbsolute: {
    position: "absolute",
    zIndex: 60,
    ...(Platform.OS === "web" ? { boxShadow: "0 4px 14px rgba(0,0,0,0.35)" } : {}),
  },
  deskCommsFabDefaultSlot: {
    right: 12,
    top: "50%",
    marginTop: -23,
  },
  deskCommsFabInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 999,
  },
  deskCommsFabTx: { fontWeight: "900", fontSize: 13, color: TacticalPalette.matteBlack },
});
