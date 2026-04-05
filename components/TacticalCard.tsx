import { Link } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { TacticalPalette } from "@/constants/TacticalTheme";

type TacticalCardProps = {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  href?: string;
  externalUrl?: string;
  /** Runs instead of navigation / external browser when set */
  onCustomPress?: () => void;
  style?: ViewStyle;
};

export function TacticalCard({ title, subtitle, icon, href, externalUrl, onCustomPress, style }: TacticalCardProps) {
  const inner = (
    <View style={[styles.inner, style]}>
      {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
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
    return (
      <Link href={href as never} asChild>
        <Pressable style={pressStyle}>{inner}</Pressable>
      </Link>
    );
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
});
