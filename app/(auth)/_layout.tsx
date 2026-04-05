import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: true, title: "MM" }}>
      <Stack.Screen name="login" options={{ title: "Access" }} />
      <Stack.Screen name="setup" options={{ title: "Initialize" }} />
      <Stack.Screen name="unlock" options={{ title: "Unlock" }} />
    </Stack>
  );
}
