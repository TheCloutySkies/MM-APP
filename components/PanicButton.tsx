import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
    useColorScheme,
} from "react-native";

import Colors from "@/constants/Colors";
import { getDistressWebhookUrl } from "@/lib/env";
import { useMMStore } from "@/store/mmStore";

type Props = { variant?: "compact" | "full" };

export function PanicButton({ variant = "full" }: Props) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const fullLock = useMMStore((s) => s.fullLock);
  const username = useMMStore((s) => s.username);

  const fire = useCallback(async () => {
    setBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      let lat = 0;
      let lng = 0;
      if (perm.status === "granted") {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      }
      const url = getDistressWebhookUrl();
      if (url) {
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            t: "mm_distress",
            u: username,
            lat,
            lng,
            ts: Date.now(),
          }),
        }).catch(() => {});
      }
      await fullLock();
      router.replace("/(auth)/login");
    } finally {
      setBusy(false);
    }
  }, [fullLock, router, username]);

  const compact = variant === "compact";

  return (
    <View>
      <Pressable
        accessibilityHint="Hold three seconds to send distress and lock"
        accessibilityRole="button"
        disabled={busy}
        delayLongPress={3000}
        onLongPress={() => void fire()}
        style={({ pressed }) => [
          styles.btn,
          compact && styles.compact,
          {
            borderColor: "#9b2226",
            backgroundColor: pressed ? "#4a0c0e" : "#1a0506",
          },
        ]}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={[styles.lbl, { color: c.text }]}>
            {compact ? "PAN" : "PANIC — hold 3s"}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  compact: { paddingVertical: 8, minHeight: 40 },
  lbl: { fontWeight: "700", letterSpacing: 1 },
});
