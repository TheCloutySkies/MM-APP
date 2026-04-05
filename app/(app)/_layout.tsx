import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Platform, StyleSheet } from "react-native";

import { ScorchedEarthListener } from "@/components/ScorchedEarthListener";
import { useDeadManMonitor } from "@/hooks/useDeadManMonitor";
import { useTacticalChrome } from "@/hooks/useTacticalChrome";
import { useMMStore } from "@/store/mmStore";

function TabIcon(props: { name: ComponentProps<typeof FontAwesome>["name"]; color: string }) {
  return <FontAwesome size={26} style={{ marginBottom: -2 }} {...props} />;
}

export default function AppLayout() {
  const desktopMode = useMMStore((s) => s.desktopMode);
  useDeadManMonitor();

  const isWebDesk = Platform.OS === "web" && desktopMode;
  const theme = useTacticalChrome();

  return (
    <>
      <ScorchedEarthListener />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: theme.tint,
          tabBarInactiveTintColor: theme.tabIconDefault,
          headerShown: false,
          tabBarStyle: isWebDesk
            ? {
                width: 96,
                backgroundColor: theme.background,
                borderRightWidth: StyleSheet.hairlineWidth,
                borderRightColor: "#3a4238",
                elevation: 0,
              }
            : {
                backgroundColor: theme.background,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: "#3a4238",
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
          name="missions"
          options={{
            title: "Missions",
            tabBarIcon: ({ color }) => <TabIcon name="folder" color={color} />,
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
    </>
  );
}
