import { Stack } from "expo-router";

import { TacticalPalette } from "@/constants/TacticalTheme";

/** Full-bleed tactical screens — each route renders its own “MM” chrome (no duplicate stack header). */
const authScreenOptions = {
  headerShown: false,
  contentStyle: { flex: 1 as const, backgroundColor: TacticalPalette.matteBlack },
};

export default function AuthLayout() {
  return (
    <Stack screenOptions={authScreenOptions}>
      <Stack.Screen name="login" />
      <Stack.Screen name="callsign" />
    </Stack>
  );
}
