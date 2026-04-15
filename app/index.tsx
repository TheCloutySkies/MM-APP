import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { TacticalPalette } from "@/constants/TacticalTheme";
import { getAuthSupabase } from "@/lib/supabase/authSupabase";
import { useMMStore } from "@/store/mmStore";

export default function Index() {
  const hydrate = useMMStore((s) => s.hydrateFromStorage);
  const callsignOk = useMMStore((s) => s.callsignOk);
  const [sessionOk, setSessionOk] = useState<boolean | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    let cancelled = false;
    const client = getAuthSupabase();
    void client.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setSessionOk(Boolean(data.session?.user));
      })
      .catch(() => {
        if (cancelled) return;
        setSessionOk(false);
      });
    const { data } = client.auth.onAuthStateChange((_evt, session) => {
      if (cancelled) return;
      setSessionOk(Boolean(session?.user));
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  if (sessionOk == null) {
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

  // Hardcoded secure-cloud state machine:
  // - valid Supabase session => main app
  // - no session => login
  if (!sessionOk) return <Redirect href="/(auth)/login" />;
  if (!callsignOk) return <Redirect href="/(auth)/callsign" />;
  return <Redirect href="/(app)/home" />;
}
