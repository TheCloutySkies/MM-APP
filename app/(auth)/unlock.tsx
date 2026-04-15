import { Redirect } from "expo-router";

/** Secure-cloud pivot: unlock step removed; Supabase session is sufficient. */
export default function UnlockScreen() {
  return <Redirect href="/(app)/home" />;
}
