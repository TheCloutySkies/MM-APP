/**
 * Tactical woodland palette — flat tones only (no bitmap camo).
 * Semantic tokens for surfaces, borders, and accents.
 */
export const TacticalPalette = {
  matteBlack: "#0d0f0c",
  charcoal: "#1a1e18",
  elevated: "#242a22",
  panel: "#2c332b",
  panelHover: "#363d34",
  oliveDrab: "#3d4a35",
  oliveMuted: "#4a5640",
  coyote: "#8b7355",
  coyoteDim: "#6b5a45",
  bone: "#e8e4d9",
  boneMuted: "#b8b4a8",
  border: "#3a4238",
  borderLight: "#4f584c",
  accent: "#6b8e5c",
  accentDim: "#556f4a",
  danger: "#c45c4a",
  success: "#6b9e6b",
} as const;

export type TacticalColors = {
  background: string;
  surface: string;
  elevated: string;
  panel: string;
  text: string;
  textMuted: string;
  tint: string;
  tabIconDefault: string;
  tabIconSelected: string;
  border: string;
  borderLight: string;
  accent: string;
  danger: string;
  success: string;
};

/** Dark-first tactical chrome (used for both schemes unless overridden). */
export const TacticalDark: TacticalColors = {
  background: TacticalPalette.matteBlack,
  surface: TacticalPalette.charcoal,
  elevated: TacticalPalette.elevated,
  panel: TacticalPalette.panel,
  text: TacticalPalette.bone,
  textMuted: TacticalPalette.boneMuted,
  tint: TacticalPalette.accent,
  tabIconDefault: TacticalPalette.coyoteDim,
  tabIconSelected: TacticalPalette.bone,
  border: TacticalPalette.border,
  borderLight: TacticalPalette.borderLight,
  accent: TacticalPalette.accent,
  danger: TacticalPalette.danger,
  success: TacticalPalette.success,
};

/** Slightly lifted surfaces for “light” mode — still woodland, not paper-white. */
export const TacticalLight: TacticalColors = {
  background: "#1c211c",
  surface: "#232923",
  elevated: TacticalPalette.elevated,
  panel: TacticalPalette.panel,
  text: TacticalPalette.bone,
  textMuted: TacticalPalette.boneMuted,
  tint: TacticalPalette.accent,
  tabIconDefault: "#7a6b55",
  tabIconSelected: TacticalPalette.bone,
  border: TacticalPalette.border,
  borderLight: TacticalPalette.borderLight,
  accent: TacticalPalette.accent,
  danger: TacticalPalette.danger,
  success: TacticalPalette.success,
};

/** Pure black / deep red “night ops” chrome */
export const TacticalNightOps: TacticalColors = {
  background: "#000000",
  surface: "#070707",
  elevated: "#0f0f0f",
  panel: "#141414",
  text: "#f5e6e6",
  textMuted: "#9a8585",
  tint: "#9b2335",
  tabIconDefault: "#7a5558",
  tabIconSelected: "#ffb3bc",
  border: "#2a1518",
  borderLight: "#3d2026",
  accent: "#c42d40",
  danger: "#ff4d5e",
  success: "#4a7c59",
};

export type VisualThemeId = "woodland" | "nightops";

export function resolveTacticalChrome(
  visualTheme: VisualThemeId,
  colorScheme: "light" | "dark",
): TacticalColors {
  if (visualTheme === "nightops") return TacticalNightOps;
  return colorScheme === "dark" ? TacticalDark : TacticalLight;
}

export const transitionEase = "0.2s ease-in-out";
