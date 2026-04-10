import { createElement, useMemo } from "react";
import { useDropzone } from "react-dropzone";
import { StyleSheet, Text, View } from "react-native";

import { TacticalPalette } from "@/constants/TacticalTheme";

type Props = {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
};

export function VaultDropZone({ disabled, onFiles }: Props) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    disabled,
    multiple: true,
    noKeyboard: true,
    onDropAccepted: onFiles,
  });

  const rootProps = useMemo(() => getRootProps(), [getRootProps]);

  return (
    <View
      // react-dropzone DOM handlers are web-only; RN Web `View` accepts them at runtime.
      {...(rootProps as Record<string, unknown>)}
      style={[
        styles.zone,
        { borderColor: isDragActive ? TacticalPalette.accent : TacticalPalette.border },
        isDragActive ? { backgroundColor: "rgba(107, 142, 92, 0.12)" } : null,
      ]}>
      {createElement("input", getInputProps())}
      <Text style={styles.title}>{isDragActive ? "Drop to encrypt & upload…" : "Drag files here"}</Text>
      <Text style={styles.sub}>Encrypted on-device (AES-GCM) before upload · max ~50 MB</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  zone: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 14,
    marginBottom: 12,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  title: {
    color: TacticalPalette.bone,
    fontWeight: "800",
    fontSize: 14,
    marginBottom: 4,
    textAlign: "center",
  },
  sub: {
    color: TacticalPalette.boneMuted,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
  },
});
