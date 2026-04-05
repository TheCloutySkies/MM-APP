import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Link, Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

import { PanicButton } from "@/components/PanicButton";
import { ScorchedEarthListener } from "@/components/ScorchedEarthListener";
import { useClientOnlyValue } from "@/components/useClientOnlyValue";
import { useColorScheme } from "@/components/useColorScheme";
import Colors from "@/constants/Colors";
import { useDeadManMonitor } from "@/hooks/useDeadManMonitor";
import { useMMStore } from "@/store/mmStore";

function TabIcon(props: { name: ComponentProps<typeof FontAwesome>["name"]; color: string }) {
  return <FontAwesome size={26} style={{ marginBottom: -2 }} {...props} />;
}

export default function AppLayout() {
  const colorScheme = useColorScheme();
  const desktopMode = useMMStore((s) => s.desktopMode);
  useDeadManMonitor();

  const isWebDesk = Platform.OS === "web" && desktopMode;
  const scheme = colorScheme ?? "light";
  const theme = Colors[scheme];

  return (
    <>
      <ScorchedEarthListener />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: theme.tint,
          tabBarInactiveTintColor: theme.tabIconDefault,
          headerShown: useClientOnlyValue(false, true),
          headerStyle: {
            backgroundColor: theme.background,
          },
          headerTintColor: theme.text,
          tabBarStyle: isWebDesk
            ? {
                width: 96,
                backgroundColor: theme.background,
                borderRightWidth: StyleSheet.hairlineWidth,
                borderRightColor: scheme === "dark" ? "#3f3f46" : "#e4e4e7",
                elevation: 0,
              }
            : { backgroundColor: theme.background },
          ...(isWebDesk
            ? {
                tabBarPosition: "left" as const,
                tabBarVariant: "material" as const,
                tabBarShowLabel: true,
              }
            : {}),
        }}>
        <Tabs.Screen
          name="vault"
          options={{
            title: "Vault",
            tabBarIcon: ({ color }) => <TabIcon name="lock" color={color} />,
            headerRight: () => (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginRight: 8 }}>
                <PanicButton variant="compact" />
                <Link href="/(app)/settings" asChild>
                  <Pressable accessibilityRole="button">
                    <FontAwesome name="cog" size={22} color={Colors[colorScheme ?? "light"].text} />
                  </Pressable>
                </Link>
              </View>
            ),
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
