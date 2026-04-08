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

/** Near-black + crimson cast — low emission, minimal visible signature (tactical “red light” UI). */
export const TacticalNightOps: TacticalColors = {
  background: "#020102",
  surface: "#0c0406",
  elevated: "#14080b",
  panel: "#1a0c0f",
  text: "#efd8dc",
  textMuted: "#8a656a",
  tint: "#d63d52",
  tabIconDefault: "#9a5a62",
  tabIconSelected: "#ffc4cc",
  border: "#3d1820",
  borderLight: "#52232c",
  accent: "#e04556",
  danger: "#ff6b7a",
  success: "#3d6b4f",
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
