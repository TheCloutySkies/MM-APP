import type { ComponentProps, ComponentType } from "react";
import { useCallback, useMemo, useRef } from "react";
import { PanResponder, Platform, View, type ViewStyle } from "react-native";

import { useMMStore } from "@/store/mmStore";

type Variant = "desk" | "mob";

const HIT = 6;

const MouseView = View as ComponentType<
  ComponentProps<typeof View> & {
    onMouseDown?: (e: { nativeEvent: MouseEvent; preventDefault(): void }) => void;
  }
>;

export function TabRailResizeEdge({ variant }: { variant: Variant }) {
  const setW = useMMStore((s) => s.setTabRailWidthPx);
  const setH = useMMStore((s) => s.setTabRailHeightPx);
  const persist = useMMStore((s) => s.persistTabRailGeometry);

  const start = useRef({ w: 96, h: 72 });

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => Platform.OS !== "web",
        onMoveShouldSetPanResponder: () => Platform.OS !== "web",
        onPanResponderGrant: () => {
          const s = useMMStore.getState();
          start.current = { w: s.tabRailWidthPx, h: s.tabRailHeightPx };
        },
        onPanResponderMove: (_, g) => {
          if (variant === "desk") setW(start.current.w + g.dx);
          else setH(start.current.h - g.dy);
        },
        onPanResponderRelease: () => void persist(),
        onPanResponderTerminate: () => void persist(),
      }),
    [variant, setW, setH, persist],
  );

  const attachWebDrag = useCallback(
    (sx: number, sy: number) => {
      const w0 = useMMStore.getState().tabRailWidthPx;
      const h0 = useMMStore.getState().tabRailHeightPx;
      const move = (m: MouseEvent) => {
        if (variant === "desk") setW(w0 + (m.clientX - sx));
        else setH(h0 - (m.clientY - sy));
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        void persist();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    },
    [variant, setW, setH, persist],
  );

  const deskStyle: ViewStyle = {
    width: HIT,
    alignSelf: "stretch",
    backgroundColor: "rgba(127,142,92,0.12)",
    ...(Platform.OS === "web" ? ({ cursor: "col-resize" } as unknown as ViewStyle) : {}),
  };

  const mobStyle: ViewStyle = {
    width: "100%",
    height: HIT,
    flexShrink: 0,
    backgroundColor: "rgba(127,142,92,0.12)",
    ...(Platform.OS === "web" ? ({ cursor: "row-resize" } as unknown as ViewStyle) : {}),
  };

  const hitStyle = variant === "desk" ? deskStyle : mobStyle;

  if (Platform.OS === "web") {
    return (
      <MouseView
        accessibilityRole="adjustable"
        accessibilityLabel={variant === "desk" ? "Resize sidebar width" : "Resize tab bar height"}
        style={hitStyle}
        onMouseDown={(e) => {
          e.preventDefault();
          const m = e.nativeEvent;
          attachWebDrag(m.clientX, m.clientY);
        }}
      />
    );
  }

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={variant === "desk" ? "Resize sidebar width" : "Resize tab bar height"}
      style={hitStyle}
      {...pan.panHandlers}
    />
  );
}
