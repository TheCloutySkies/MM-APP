import FontAwesome from "@expo/vector-icons/FontAwesome";
import { type ReactNode, useState } from "react";
import { LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View } from "react-native";

import { useTacticalChrome } from "@/hooks/useTacticalChrome";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Props = {
  title: string;
  /** Optional controls in header row (e.g. small buttons). */
  headerActions?: ReactNode;
  /** Start expanded. */
  defaultOpen?: boolean;
  children: ReactNode;
};

/**
 * Calcite-block–inspired collapsible for dense doctrine / vault / reports sections.
 * Uses tactical chrome (including Night Ops) without Esri web components.
 */
export function TacticalBlock({ title, headerActions, defaultOpen = true, children }: Props) {
  const chrome = useTacticalChrome();
  const [open, setOpen] = useState(defaultOpen);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((v) => !v);
  };

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: chrome.panel,
          borderColor: chrome.border,
        },
      ]}>
      <View style={styles.headRow}>
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={styles.headMain}
          hitSlop={8}>
          <FontAwesome name={open ? "chevron-down" : "chevron-right"} size={12} color={chrome.tabIconDefault} />
          <Text style={[styles.title, { color: chrome.text }]} numberOfLines={2}>
            {title}
          </Text>
        </Pressable>
        {headerActions ? <View style={styles.actions}>{headerActions}</View> : null}
      </View>
      {open ? <View style={[styles.body, { borderTopColor: chrome.border }]}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginBottom: 12,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  headMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  actions: {
    flexShrink: 0,
  },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 4,
  },
});
