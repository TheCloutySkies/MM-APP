import { Redirect } from "expo-router";

/** Secure-cloud pivot: vault setup is removed; Supabase session is sufficient. */
export default function SetupScreen() {
  return <Redirect href="/(app)/home" />;
}
