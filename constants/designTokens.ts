import type { TacticalColors } from "@/constants/TacticalTheme";

/**
 * Semantic design tokens (Calcite-style) mapped to CSS custom properties for web.
 * React Native screens continue to use `useTacticalChrome()`; web also mirrors tokens
 * on `:root` for raw HTML / future Tailwind-style usage without adding Esri packages.
 */
export const MM_CSS = {
  background: "--mm-color-background",
  surface: "--mm-color-surface",
  surfaceElevated: "--mm-color-surface-elevated",
  panel: "--mm-color-panel",
  foreground: "--mm-color-foreground",
  foregroundMuted: "--mm-color-foreground-muted",
  brand: "--mm-color-brand",
  danger: "--mm-color-danger",
  success: "--mm-color-success",
  border: "--mm-color-border",
  borderLight: "--mm-color-border-light",
  tint: "--mm-color-tint",
  tabIcon: "--mm-color-tab-icon",
  tabIconSelected: "--mm-color-tab-icon-selected",
} as const;

/** Apply tactical chrome to `document.documentElement` (web only). */
export function tacticalChromeToCssVars(chrome: TacticalColors): Record<string, string> {
  return {
    [MM_CSS.background]: chrome.background,
    [MM_CSS.surface]: chrome.surface,
    [MM_CSS.surfaceElevated]: chrome.elevated,
    [MM_CSS.panel]: chrome.panel,
    [MM_CSS.foreground]: chrome.text,
    [MM_CSS.foregroundMuted]: chrome.textMuted,
    [MM_CSS.brand]: chrome.accent,
    [MM_CSS.danger]: chrome.danger,
    [MM_CSS.success]: chrome.success,
    [MM_CSS.border]: chrome.border,
    [MM_CSS.borderLight]: chrome.borderLight,
    [MM_CSS.tint]: chrome.tint,
    [MM_CSS.tabIcon]: chrome.tabIconDefault,
    [MM_CSS.tabIconSelected]: chrome.tabIconSelected,
  };
}
