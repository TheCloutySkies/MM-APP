import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { TacticalPalette } from "@/constants/TacticalTheme";
import { useMMStore } from "@/store/mmStore";

export default function Index() {
  const hydrated = useMMStore((s) => s.hydrated);
  const token = useMMStore((s) => s.accessToken);
  const setup = useMMStore((s) => s.setupComplete);
  const vaultMode = useMMStore((s) => s.vaultMode);

  if (!hydrated) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: TacticalPalette.matteBlack,
        }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!token) return <Redirect href="/(auth)/login" />;
  if (!setup) return <Redirect href="/(auth)/setup" />;
  if (!vaultMode) return <Redirect href="/(auth)/unlock" />;
  return <Redirect href="/(app)/home" />;
}
