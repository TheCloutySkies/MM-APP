import { TacticalDark, TacticalLight, type TacticalColors } from "@/constants/TacticalTheme";

export type { TacticalColors };

const light = {
  text: TacticalLight.text,
  background: TacticalLight.background,
  tint: TacticalLight.tint,
  tabIconDefault: TacticalLight.tabIconDefault,
  tabIconSelected: TacticalLight.tabIconSelected,
};

const dark = {
  text: TacticalDark.text,
  background: TacticalDark.background,
  tint: TacticalDark.tint,
  tabIconDefault: TacticalDark.tabIconDefault,
  tabIconSelected: TacticalDark.tabIconSelected,
};

/**
 * App color scheme: tactical woodland for both light and dark (dark-first PWA).
 */
export default { light, dark };

/** Full semantic tactical tokens when you need surfaces, borders, etc. */
export const tacticalByScheme = { light: TacticalLight, dark: TacticalDark } as const;
