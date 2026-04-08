import { useCallback, useMemo } from "react";
import { Platform, useWindowDimensions } from "react-native";

import { useLayoutContextOptional } from "@/components/layout/LayoutProvider";
import {
  getLayoutPreference,
  type LayoutPreference,
  reloadWebApp,
  resolveDesktopFromLayoutPref,
  setLayoutPreference,
} from "@/lib/layout/layoutPreference";

/**
 * Layout preference (mobile / desktop / auto) plus effective “war room” desktop flag.
 * When `LayoutProvider` is mounted, preference is synced from Supabase after sign-in.
 */
export function useLayoutMode() {
  const ctx = useLayoutContextOptional();
  const { width } = useWindowDimensions();
  const preference = ctx?.preference ?? getLayoutPreference();
  const effectiveDesktop = useMemo(
    () => resolveDesktopFromLayoutPref(width, preference),
    [width, preference],
  );

  const setPreferenceAndReload = useCallback(
    (pref: LayoutPreference) => {
      if (ctx) {
        void ctx.setLayoutPreferenceFull(pref, { reloadWeb: Platform.OS === "web" });
      } else {
        setLayoutPreference(pref);
        reloadWebApp();
      }
    },
    [ctx],
  );

  return {
    preference,
    effectiveDesktop,
    isMobileLayout: !effectiveDesktop,
    setPreferenceAndReload,
  };
}
