import type { BottomTabBarProps, BottomTabNavigationOptions } from "@react-navigation/bottom-tabs";
import type { ComponentProps, ComponentType, PropsWithChildren } from "react";
import { useMemo, useRef } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { isMainTabRouteId, MAIN_TAB_ROUTE_SET, MM_TAB_DRAG_MIME, type MainTabRouteId } from "@/constants/mainTabs";
import { useTacticalChrome } from "@/hooks/useTacticalChrome";
import { useMMStore } from "@/store/mmStore";

type MMTabBarProps = BottomTabBarProps & { style?: StyleProp<ViewStyle> };

function tabLabel(name: string, options: BottomTabNavigationOptions): string {
  if (typeof options.title === "string" && options.title) return options.title;
  return name.slice(0, 1).toUpperCase() + name.slice(1);
}

/** RN `View` props omit web drag attributes; cast once for tab reorder / drop targets. */
const DragWebView = View as ComponentType<
  PropsWithChildren<
    ComponentProps<typeof View> & {
      draggable?: boolean;
      onDragStart?: (e: { nativeEvent?: DragEvent | undefined }) => void;
      onDragEnd?: () => void;
      onDragOver?: (e: { preventDefault(): void }) => void;
      onDrop?: (e: unknown) => void;
    }
  >
>;

/** Custom tab bar: user order from store, drag reorder + drop from home (web). */
export function MMTabBar({ state, descriptors, navigation, insets, style }: MMTabBarProps) {
  const theme = useTacticalChrome();
  const desktopMode = useMMStore((s) => s.desktopMode);
  const tabBarOrder = useMMStore((s) => s.tabBarOrder);
  const reorderMainTabs = useMMStore((s) => s.reorderMainTabs);

  const isWebDesk = Platform.OS === "web" && desktopMode;
  const dragPayloadRef = useRef<string | null>(null);

  const mainRoutes = useMemo(
    () => state.routes.filter((r) => MAIN_TAB_ROUTE_SET.has(r.name)),
    [state.routes],
  );

  const orderedRoutes = useMemo(() => {
    const rank = (name: string) => {
      const i = tabBarOrder.indexOf(name as MainTabRouteId);
      return i === -1 ? 999 : i;
    };
    return [...mainRoutes].sort((a, b) => rank(a.name) - rank(b.name));
  }, [mainRoutes, tabBarOrder]);

  const activeKey = state.routes[state.index]?.key;

  const runNavigate = (route: (typeof state.routes)[number]) => {
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });
    if (!event.defaultPrevented) {
      navigation.navigate(route.name as never);
    }
  };

  const webDragStart = (routeName: string) => (e: { nativeEvent?: DragEvent }) => {
    if (Platform.OS !== "web") return;
    const dt = e.nativeEvent?.dataTransfer;
    if (dt) {
      dt.setData(MM_TAB_DRAG_MIME, routeName);
      dt.effectAllowed = "move";
    }
    dragPayloadRef.current = routeName;
  };

  const webDragEnd = () => {
    dragPayloadRef.current = null;
  };

  const prevent = (e: { preventDefault(): void }) => {
    e.preventDefault();
  };

  const readDragId = (e: {
    dataTransfer?: DataTransfer | null;
    nativeEvent?: { dataTransfer?: DataTransfer | null };
  }): string | null => {
    const dt = e.dataTransfer ?? e.nativeEvent?.dataTransfer;
    const fromDt = dt?.getData(MM_TAB_DRAG_MIME)?.trim();
    if (fromDt && isMainTabRouteId(fromDt)) return fromDt;
    const ref = dragPayloadRef.current;
    return ref && isMainTabRouteId(ref) ? ref : null;
  };

  const onDropBefore = (anchorId: MainTabRouteId) => (e: unknown) => {
    if (Platform.OS !== "web") return;
    prevent(e as { preventDefault(): void });
    const id = readDragId(e as { dataTransfer?: DataTransfer; nativeEvent?: { dataTransfer?: DataTransfer } });
    if (!id || !isMainTabRouteId(id) || id === anchorId) return;
    void reorderMainTabs(id, anchorId);
    dragPayloadRef.current = null;
  };

  const onRailDrop = (e: unknown) => {
    if (Platform.OS !== "web") return;
    prevent(e as { preventDefault(): void });
    const id = readDragId(e as { dataTransfer?: DataTransfer; nativeEvent?: { dataTransfer?: DataTransfer } });
    if (!id || !isMainTabRouteId(id) || orderedRoutes.length === 0) return;
    const first = orderedRoutes[0].name;
    if (!isMainTabRouteId(first)) return;
    void reorderMainTabs(id, first);
    dragPayloadRef.current = null;
  };

  const railDeskStyle: ViewStyle = {
    flexDirection: "column",
    width: 96,
    paddingTop: 8 + insets.top,
    paddingBottom: 12 + insets.bottom,
    backgroundColor: theme.background,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "#3a4238",
  };

  const railMobileStyle: ViewStyle = {
    flexDirection: "row",
    paddingBottom: Math.max(insets.bottom, 8),
    paddingTop: 8,
    paddingHorizontal: 4,
    backgroundColor: theme.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#3a4238",
  };

  const railStyle: StyleProp<ViewStyle> = [styles.railBase, isWebDesk ? railDeskStyle : railMobileStyle, style];

  return (
    <View
      style={railStyle}
      {...(Platform.OS === "web"
        ? {
            onDragOver: prevent,
            onDrop: onRailDrop,
          }
        : {})}>
      {orderedRoutes.map((route) => {
        const { options } = descriptors[route.key];
        const focused = route.key === activeKey;
        const color = focused ? theme.tint : theme.tabIconDefault;
        const icon =
          options.tabBarIcon?.({
            focused,
            color,
            size: 26,
          }) ?? null;
        const label = tabLabel(route.name, options);

        const cell = (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            onPress={() => runNavigate(route)}
            style={({ pressed }) => [
              styles.cell,
              isWebDesk ? styles.cellVert : styles.cellHorz,
              { opacity: pressed ? 0.82 : 1, backgroundColor: focused ? "rgba(127,142,92,0.18)" : "transparent" },
            ]}>
            {icon}
            {options.tabBarShowLabel !== false ? (
              <Text style={[styles.label, { color }]} numberOfLines={2}>
                {label}
              </Text>
            ) : null}
          </Pressable>
        );

        if (Platform.OS !== "web" || !isMainTabRouteId(route.name)) {
          return (
            <View key={route.key} style={isWebDesk ? styles.cellOuterVert : undefined}>
              {cell}
            </View>
          );
        }

        const anchorId = route.name as MainTabRouteId;

        return (
          <DragWebView
            key={route.key}
            style={isWebDesk ? styles.cellOuterVert : styles.cellOuterHorz}
            draggable
            onDragStart={webDragStart(route.name)}
            onDragEnd={webDragEnd}
            onDragOver={prevent}
            onDrop={onDropBefore(anchorId)}>
            {cell}
          </DragWebView>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  railBase: {
    alignItems: "stretch",
  },
  cellOuterVert: {
    alignSelf: "stretch",
  },
  cellOuterHorz: {
    flex: 1,
  },
  cell: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  cellVert: {
    flexDirection: "column",
    gap: 4,
  },
  cellHorz: {
    flexDirection: "column",
    gap: 2,
  },
  label: { fontSize: 10, fontWeight: "600", textAlign: "center" },
});
