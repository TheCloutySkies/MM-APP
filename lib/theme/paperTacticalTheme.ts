import { MD3DarkTheme, type MD3Theme } from "react-native-paper";

import { TacticalPalette } from "@/constants/TacticalTheme";

/** MD3 dark theme aligned with TacticalPalette so Paper surfaces match app chrome. */
export const tacticalPaperTheme: MD3Theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: TacticalPalette.accent,
    onPrimary: TacticalPalette.matteBlack,
    primaryContainer: TacticalPalette.oliveDrab,
    onPrimaryContainer: TacticalPalette.bone,
    secondary: TacticalPalette.coyote,
    onSecondary: TacticalPalette.matteBlack,
    secondaryContainer: TacticalPalette.coyoteDim,
    onSecondaryContainer: TacticalPalette.bone,
    tertiary: TacticalPalette.oliveMuted,
    background: TacticalPalette.matteBlack,
    surface: TacticalPalette.charcoal,
    surfaceVariant: TacticalPalette.panel,
    onSurface: TacticalPalette.bone,
    onSurfaceVariant: TacticalPalette.boneMuted,
    outline: TacticalPalette.border,
    outlineVariant: TacticalPalette.borderLight,
    error: TacticalPalette.danger,
    onError: TacticalPalette.bone,
    elevation: {
      ...MD3DarkTheme.colors.elevation,
      level0: TacticalPalette.matteBlack,
      level1: TacticalPalette.charcoal,
      level2: TacticalPalette.elevated,
      level3: TacticalPalette.panel,
      level4: TacticalPalette.panel,
      level5: TacticalPalette.panelHover,
    },
  },
};
