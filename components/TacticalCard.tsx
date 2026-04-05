import { Link } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import type { ComponentProps, ComponentType, PropsWithChildren, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { MM_TAB_DRAG_MIME, type MainTabRouteId } from "@/constants/mainTabs";
import { TacticalPalette } from "@/constants/TacticalTheme";

const DragSourceView = View as ComponentType<
  PropsWithChildren<
    ComponentProps<typeof View> & {
      draggable?: boolean;
      onDragStart?: (e: { nativeEvent?: DragEvent | undefined }) => void;
    }
  >
>;

type TacticalCardProps = {
  title: string;
  subtitle?: string;
  /** Small footnote under subtitle (e.g. security reassurance). */
  detail?: string;
  icon?: ReactNode;
  href?: string;
  externalUrl?: string;
  /** Runs instead of navigation / external browser when set */
  onCustomPress?: () => void;
  style?: ViewStyle;
  /** Web: drag this card onto the tab rail to reorder / pin that tab. */
  tabBarDragId?: MainTabRouteId;
  /** Long-press to move this tab before the first item in the rail order. */
  onPinToTabBar?: () => void;
};

export function TacticalCard({
  title,
  subtitle,
  detail,
  icon,
  href,
  externalUrl,
  onCustomPress,
  style,
  tabBarDragId,
  onPinToTabBar,
}: TacticalCardProps) {
  const inner = (
    <View style={[styles.inner, style]}>
      {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );

  const pressStyle = ({ pressed }: { pressed: boolean }) => [styles.card, pressed && styles.cardPressed];

  if (onCustomPress) {
    return (
      <Pressable style={pressStyle} onPress={onCustomPress}>
        {inner}
      </Pressable>
    );
  }

  if (externalUrl) {
    return (
      <Pressable
        style={pressStyle}
        onPress={() => {
          void WebBrowser.openBrowserAsync(externalUrl);
        }}>
        {inner}
      </Pressable>
    );
  }

  if (href) {
    const linked = (
      <Link href={href as never} asChild>
        <Pressable
          style={pressStyle}
          {...(onPinToTabBar ? { onLongPress: onPinToTabBar, delayLongPress: 480 } : {})}>
          {inner}
        </Pressable>
      </Link>
    );

    if (tabBarDragId && Platform.OS === "web") {
      return (
        <DragSourceView
          draggable
          onDragStart={(e) => {
            const dt = e.nativeEvent?.dataTransfer;
            if (dt) {
              dt.setData(MM_TAB_DRAG_MIME, tabBarDragId);
              dt.effectAllowed = "copyMove";
            }
          }}>
          {linked}
        </DragSourceView>
      );
    }

    return linked;
  }

  return <View style={[styles.card, style]}>{inner}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: TacticalPalette.elevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TacticalPalette.border,
    borderRadius: 10,
    overflow: "hidden",
  },
  cardPressed: {
    opacity: 0.88,
    backgroundColor: TacticalPalette.panel,
  },
  inner: {
    padding: 18,
    minHeight: 100,
  },
  iconWrap: {
    marginBottom: 10,
  },
  title: {
    color: TacticalPalette.bone,
    fontSize: 17,
    fontWeight: "600",
  },
  subtitle: {
    color: TacticalPalette.boneMuted,
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
  },
  detail: {
    color: TacticalPalette.boneMuted,
    fontSize: 11,
    marginTop: 8,
    lineHeight: 16,
    opacity: 0.92,
  },
});
