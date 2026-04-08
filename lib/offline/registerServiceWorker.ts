import { Platform } from "react-native";

const READY_KEY = "mm_pwa_shell_ready_toast_shown";

/**
 * Registers `/sw.js` (from `public/`) for Expo web static export.
 * Dispatches `mm-offline-shell-ready` on first activation (for a one-time UI hint).
 */
export function registerMmServiceWorker(): void {
  if (Platform.OS !== "web" || typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) =>
        reg
          .update()
          .catch(() => {})
          .then(() => reg),
      )
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        try {
          if (window.localStorage.getItem(READY_KEY) === "1") return;
          window.localStorage.setItem(READY_KEY, "1");
          window.dispatchEvent(new CustomEvent("mm-offline-shell-ready"));
        } catch {
          window.dispatchEvent(new CustomEvent("mm-offline-shell-ready"));
        }
      })
      .catch(() => {
        /* no SW in dev / blocked */
      });
  });
}
