import type { SupabaseClient } from "@supabase/supabase-js";

import { SK, secureGet } from "@/lib/secure/mmSecureStore";
import { getAuthSupabase } from "@/lib/supabase/authSupabase";
import { isJwtExpired, jwtSub } from "@/lib/supabase/jwtExp";
import { createMMSupabase } from "@/lib/supabase/mmClient";
import { useMMStore } from "@/store/mmStore";

/**
 * Calendar PIN unlock needs `profileId` + `supabase`. After static export / refresh, the store can
 * briefly lag secure storage; this reconciles token, id, and client from Keychain / localStorage.
 */
export async function ensureMmCalendarSession(): Promise<{
  profileId: string | null;
  supabase: SupabaseClient | null;
}> {
  await useMMStore.getState().reconcileProfileIdFromJwt();

  let profileId = useMMStore.getState().profileId;
  let supabase = useMMStore.getState().supabase;
  if (profileId && supabase) return { profileId, supabase };

  const accessToken =
    useMMStore.getState().accessToken ?? ((await secureGet(SK.accessToken)) ?? null);
  if (!accessToken || isJwtExpired(accessToken)) {
    return { profileId: null, supabase: null };
  }

  let pid = profileId ?? ((await secureGet(SK.profileId)) ?? null);
  if (!pid) {
    const sub = jwtSub(accessToken);
    if (sub) pid = sub;
  }
  if (!pid) return { profileId: null, supabase: null };

  if (!supabase) {
    try {
      const authClient = getAuthSupabase();
      const { data } = await authClient.auth.getSession();
      const sess = data.session;
      if (sess?.access_token && !isJwtExpired(sess.access_token)) {
        supabase = authClient;
        if (!useMMStore.getState().accessToken) {
          useMMStore.setState({ accessToken: sess.access_token, sessionSource: "auth" });
        }
        const authUid = sess.user?.id;
        if (authUid && !pid) pid = authUid;
      }
    } catch {
      supabase = null;
    }
  }

  if (!supabase) {
    try {
      supabase = await createMMSupabase(accessToken);
    } catch {
      supabase = null;
    }
  }

  const username =
    useMMStore.getState().username ?? ((await secureGet(SK.username)) ?? null) ?? pid;

  useMMStore.setState({
    accessToken,
    profileId: pid,
    username,
    ...(supabase ? { supabase } : {}),
  });

  return { profileId: pid, supabase };
}
