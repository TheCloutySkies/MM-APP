import FontAwesome from "@expo/vector-icons/FontAwesome";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import "react-native-reanimated";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";

import { LayoutProvider } from "@/components/layout/LayoutProvider";
import { LayoutWelcomeGate } from "@/components/layout/LayoutWelcomeGate";
import { PwaShellReadyBanner } from "@/components/offline/PwaShellReadyBanner";
import { useColorScheme } from "@/components/useColorScheme";
import { useDesignTokensWeb } from "@/hooks/useDesignTokensWeb";
import { useTacticalChrome } from "@/hooks/useTacticalChrome";
import { registerMmServiceWorker } from "@/lib/offline/registerServiceWorker";
import { flushPendingSyncStub } from "@/lib/offline/syncQueue";
import { useMMStore } from "@/store/mmStore";
import { Platform } from "react-native";
import { PaperProvider } from "react-native-paper";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { tacticalPaperTheme } from "@/lib/theme/paperTacticalTheme";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = {
  initialRouteName: "index",
};

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: Platform.OS === "web",
    },
  },
});

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  const hydrate = useMMStore((s) => s.hydrateFromStorage);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!loaded) return null;

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const chrome = useTacticalChrome();
  useDesignTokensWeb();
  const applyLayoutBreakpoint = useMMStore((s) => s.applyLayoutBreakpoint);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    applyLayoutBreakpoint();
    const onResize = () => applyLayoutBreakpoint();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [applyLayoutBreakpoint]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    registerMmServiceWorker();
    const onLine = () => void flushPendingSyncStub();
    window.addEventListener("online", onLine);
    return () => window.removeEventListener("online", onLine);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BottomSheetModalProvider>
        <SafeAreaProvider>
          <PaperProvider theme={tacticalPaperTheme}>
            <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
              <LayoutProvider>
                <PwaShellReadyBanner />
                <LayoutWelcomeGate />
                <Stack
                  screenOptions={{
                    contentStyle: { flex: 1, backgroundColor: chrome.background },
                  }}>
                  <Stack.Screen name="index" options={{ headerShown: false }} />
                  <Stack.Screen name="(auth)" options={{ headerShown: false }} />
                  <Stack.Screen name="(app)" options={{ headerShown: false }} />
                </Stack>
              </LayoutProvider>
            </ThemeProvider>
          </PaperProvider>
        </SafeAreaProvider>
      </BottomSheetModalProvider>
    </QueryClientProvider>
  );
}
