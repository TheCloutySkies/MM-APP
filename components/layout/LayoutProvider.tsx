import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { TacticalPalette } from "@/constants/TacticalTheme";
import {
    getLayoutPreference,
    getLayoutPreferenceAsync,
    reloadWebApp,
    resolveDesktopFromLayoutPref,
    type LayoutPreference,
} from "@/lib/layout/layoutPreference";
import { getAuthSupabase } from "@/lib/supabase/authSupabase";
import {
    fetchProfileLayoutPreference,
    updateProfileLayoutPreference,
} from "@/lib/supabase/profileLayout";
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

/**
 * Merge server `mm_profiles.layout_preference` with device storage so an unset/`auto` DB row does not
 * wipe Mobile/Desktop chosen before reload (common if the profile column defaults or update lags).
 */
async function resolveMergedLayoutPreference(
  supabase: Parameters<typeof fetchProfileLayoutPreference>[0],
  profileId: string,
): Promise<LayoutPreference> {
  const remote = await fetchProfileLayoutPreference(supabase, profileId);
  const local = await getLayoutPreferenceAsync();
  if (remote == null) return local;
  if ((local === "mobile" || local === "desktop") && remote === "auto") {
    const { error: upErr } = await updateProfileLayoutPreference(supabase, profileId, local);
    if (upErr) console.warn("[layout] profile upsync after local override failed:", upErr.message);
    return local;
  }
  return remote;
}

export function LayoutProvider({ children }: Props) {
  const hydrated = useMMStore((s) => s.hydrated);
  const accessToken = useMMStore((s) => s.accessToken);
  const profileId = useMMStore((s) => s.profileId);
  const supabase = useMMStore((s) => s.supabase);
  const setLayoutTriPreference = useMMStore((s) => s.setLayoutTriPreference);

  const [preference, setPreference] = useState<LayoutPreference>("auto");
  const [layoutBootstrapReady, setLayoutBootstrapReady] = useState(false);
  const { width } = useWindowDimensions();

  /** Read persisted layout on the client before paint to avoid a flash of “auto” and odd unlock UI. */
  useLayoutEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    setPreference(getLayoutPreference());
  }, []);

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
      const LAYOUT_BOOTSTRAP_MS = 12_000;
      try {
        const next = await Promise.race([
          resolveMergedLayoutPreference(supabase, profileId),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("layout bootstrap timeout")), LAYOUT_BOOTSTRAP_MS);
          }),
        ]);
        if (cancelled) return;
        await setLayoutTriPreference(next);
        setPreference(next);
      } catch (e) {
        console.warn("[layout] bootstrap failed:", e instanceof Error ? e.message : e);
        if (!cancelled) {
          const local = await getLayoutPreferenceAsync();
          setPreference(local);
          await useMMStore.getState().setLayoutTriPreference(local);
        }
      } finally {
        if (!cancelled) setLayoutBootstrapReady(true);
      }
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
      const next = await resolveMergedLayoutPreference(authClient, session.user.id);
      await useMMStore.getState().setLayoutTriPreference(next);
      setPreference(next);
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
