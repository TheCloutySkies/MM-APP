import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Alert, Platform, Pressable, type PressableProps } from "react-native";

export type InfoHintProps = {
  title: string;
  /** With `title`, shows a simple `Alert.alert`. Ignored when `onPress` is set. */
  message?: string;
  tint?: string;
  iconSize?: number;
  onPress?: () => void;
  hitSlop?: PressableProps["hitSlop"];
  accessibilityLabel?: string;
  /** Web: native tooltip on hover where supported. */
  webTitle?: string;
};

export function InfoHint({
  title,
  message,
  tint = "#64748b",
  iconSize = 18,
  onPress,
  hitSlop = 10,
  accessibilityLabel,
  webTitle,
}: InfoHintProps) {
  const show = () => {
    if (onPress) {
      onPress();
      return;
    }
    if (message) {
      Alert.alert(title, message);
    }
  };

  const webExtras =
    Platform.OS === "web"
      ? ({ title: webTitle ?? (message ? `${title}\n\n${message}` : title) } as const)
      : {};

  return (
    <Pressable
      onPress={show}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `Help: ${title}`}
      {...webExtras}>
      <FontAwesome name="info-circle" size={iconSize} color={tint} />
    </Pressable>
  );
}
