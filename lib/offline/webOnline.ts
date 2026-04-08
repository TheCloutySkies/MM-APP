import { useEffect, useState } from "react";
import { Platform } from "react-native";

/** Web only: assume online when `navigator` missing (SSR / tests). */
export function isWebOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

/** Subscribe to browser online/offline (web only; native always reports true). */
export function useWebOnline(): boolean {
  const [online, setOnline] = useState(() => (Platform.OS === "web" ? isWebOnline() : true));

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    setOnline(isWebOnline());
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  return Platform.OS === "web" ? online : true;
}
