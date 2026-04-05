import { Stack } from "expo-router";
import { StyleSheet } from "react-native";

import { TacticalPalette } from "@/constants/TacticalTheme";

const authHeader = {
  headerShown: true,
  title: "MM",
  contentStyle: { flex: 1 as const, backgroundColor: TacticalPalette.matteBlack },
  headerStyle: {
    backgroundColor: TacticalPalette.charcoal,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TacticalPalette.border,
  },
  headerTintColor: TacticalPalette.bone,
  headerTitleStyle: { fontWeight: "700" as const },
  headerShadowVisible: false,
};

export default function AuthLayout() {
  return (
    <Stack screenOptions={authHeader}>
      <Stack.Screen name="login" options={{ title: "Access" }} />
      <Stack.Screen name="setup" options={{ title: "Initialize" }} />
      <Stack.Screen name="unlock" options={{ title: "Unlock" }} />
    </Stack>
  );
}
