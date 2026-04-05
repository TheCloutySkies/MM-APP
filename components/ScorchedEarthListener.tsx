import { useRouter } from "expo-router";
import { Accelerometer } from "expo-sensors";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { useMMStore } from "@/store/mmStore";

const SHAKE_THRESHOLD = 18;

/**
 * Sudden acceleration spike → clear in-memory keys and return to unlock.
 * “Face down” is approximated only where gravity vector shifts sharply; tune as needed.
 */
export function ScorchedEarthListener() {
  const router = useRouter();
  const unlocked = useMMStore((s) => !!s.vaultMode);
  const lock = useMMStore((s) => s.lock);
  const lastMag = useRef(0);

  useEffect(() => {
    if (!unlocked) return;
    // expo-sensors has no native bridge on web — addListener throws.
    if (Platform.OS === "web") return;
    Accelerometer.setUpdateInterval(120);
    const sub = Accelerometer.addListener((a) => {
      const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
      const delta = Math.abs(mag - lastMag.current);
      lastMag.current = mag;
      if (delta > SHAKE_THRESHOLD) {
        void (async () => {
          await lock();
          router.replace("/(auth)/unlock");
        })();
      }
    });
    return () => sub.remove();
  }, [unlocked, lock, router]);

  return null;
}
