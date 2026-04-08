import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { TacticalPalette } from "@/constants/TacticalTheme";
import {
  getLayoutPreferenceAsync,
  reloadWebApp,
  resolveDesktopFromLayoutPref,
  type LayoutPreference,
} from "@/lib/layout/layoutPreference";
import {
  fetchProfileLayoutPreference,
  updateProfileLayoutPreference,
} from "@/lib/supabase/profileLayout";
import { getAuthSupabase } from "@/lib/supabase/authSupabase";
import { useMMStore } from "@/store/mmStore";

type LayoutController = {
  preference: LayoutPreference;
  effectiveDesktop: boolean;
  /** False only while loading server layout for an authenticated session. */
  layoutBootstrapReady: boolean;
  setLayoutPreferenceFull: (pref: LayoutPreference, options?: { reloadWeb?: boolean }) => Promise<void>;
};

const LayoutContext = createContext<LayoutController | null>(null);

export function useLayoutController(): LayoutController {
  const c = useContext(LayoutContext);
  if (!c) {
    throw new Error("useLayoutController must be used within LayoutProvider");
  }
  return c;
}

/** Returns null when no provider (e.g. tests). Prefer `useLayoutController` in app shell. */
export function useLayoutContextOptional(): LayoutController | null {
  return useContext(LayoutContext);
}

type Props = { children: ReactNode };

export function LayoutProvider({ children }: Props) {
  const hydrated = useMMStore((s) => s.hydrated);
  const accessToken = useMMStore((s) => s.accessToken);
  const profileId = useMMStore((s) => s.profileId);
  const supabase = useMMStore((s) => s.supabase);
  const setLayoutTriPreference = useMMStore((s) => s.setLayoutTriPreference);

  const [preference, setPreference] = useState<LayoutPreference>("auto");
  const [layoutBootstrapReady, setLayoutBootstrapReady] = useState(false);
  const { width } = useWindowDimensions();

  const effectiveDesktop = useMemo(
    () => resolveDesktopFromLayoutPref(width, preference),
    [width, preference],
  );

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;

    const finishLocal = async () => {
      const local = await getLayoutPreferenceAsync();
      if (cancelled) return;
      setPreference(local);
      await useMMStore.getState().setLayoutTriPreference(local);
      setLayoutBootstrapReady(true);
    };

    if (!accessToken || !profileId || !supabase) {
      void finishLocal();
      return () => {
        cancelled = true;
      };
    }

    setLayoutBootstrapReady(false);
    void (async () => {
      const remote = await fetchProfileLayoutPreference(supabase, profileId);
      if (cancelled) return;
      if (remote != null) {
        await setLayoutTriPreference(remote);
        setPreference(remote);
      } else {
        await finishLocal();
        return;
      }
      if (!cancelled) setLayoutBootstrapReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrated, accessToken, profileId, supabase, setLayoutTriPreference]);

  useEffect(() => {
    const client = getAuthSupabase();
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange(async (event, session) => {
      if (event !== "SIGNED_IN" || !session?.user) return;
      const authClient = getAuthSupabase();
      const pref = await fetchProfileLayoutPreference(authClient, session.user.id);
      if (pref != null) {
        await useMMStore.getState().setLayoutTriPreference(pref);
        setPreference(pref);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const setLayoutPreferenceFull = useCallback(
    async (pref: LayoutPreference, options?: { reloadWeb?: boolean }) => {
      await setLayoutTriPreference(pref);
      setPreference(pref);
      const sb = useMMStore.getState().supabase;
      const pid = useMMStore.getState().profileId;
      if (sb && pid) {
        const { error } = await updateProfileLayoutPreference(sb, pid, pref);
        if (error) {
          console.warn("[layout] profile update failed:", error.message);
        }
      }
      if (options?.reloadWeb && Platform.OS === "web") {
        reloadWebApp();
      }
    },
    [setLayoutTriPreference],
  );

  const value = useMemo(
    () => ({
      preference,
      effectiveDesktop,
      layoutBootstrapReady,
      setLayoutPreferenceFull,
    }),
    [preference, effectiveDesktop, layoutBootstrapReady, setLayoutPreferenceFull],
  );

  const blockInteractions = hydrated && Boolean(accessToken) && !layoutBootstrapReady;

  return (
    <LayoutContext.Provider value={value}>
      {children}
      {blockInteractions ? (
        <View style={styles.bootstrap} pointerEvents="auto">
          <ActivityIndicator color={TacticalPalette.coyote} size="large" />
          <Text style={styles.bootstrapTx}>Establishing secure connection…</Text>
        </View>
      ) : null}
    </LayoutContext.Provider>
  );
}

const styles = StyleSheet.create({
  bootstrap: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5,8,6,0.94)",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    zIndex: 99999,
  },
  bootstrapTx: {
    color: TacticalPalette.boneMuted,
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
});
