import { useColorScheme } from "@/components/useColorScheme";
import type { TacticalColors } from "@/constants/TacticalTheme";
import { resolveTacticalChrome } from "@/constants/TacticalTheme";
import { useMMStore } from "@/store/mmStore";

/** Tab bar + chrome that respects Night Ops vs woodland tactical palettes. */
export function useTacticalChrome(): TacticalColors {
  const scheme = useColorScheme() ?? "light";
  const visualTheme = useMMStore((s) => s.visualTheme);
  return resolveTacticalChrome(visualTheme, scheme);
}
