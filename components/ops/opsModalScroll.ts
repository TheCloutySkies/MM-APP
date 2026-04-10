import { Platform, type ViewStyle } from "react-native";

/** Narrow phone tweak + centered column on web for ops report modals. */
export function opsModalContentExtras(winWidth: number, bottomPad = 40): ViewStyle {
  const narrow = winWidth < 430;
  return {
    paddingHorizontal: narrow ? 14 : 16,
    paddingBottom: bottomPad,
    width: "100%",
    ...(Platform.OS === "web" ? { maxWidth: 720, alignSelf: "center" } : {}),
  };
}
