import { useEffect } from "react";
import { Platform } from "react-native";

import { tacticalChromeToCssVars } from "@/constants/designTokens";
import { useTacticalChrome } from "@/hooks/useTacticalChrome";

/** Syncs tactical theme to global CSS variables on web (Night Ops / woodland swap with no layout churn). */
export function useDesignTokensWeb() {
  const chrome = useTacticalChrome();

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const root = document.documentElement;
    const vars = tacticalChromeToCssVars(chrome);
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
  }, [chrome]);
}
