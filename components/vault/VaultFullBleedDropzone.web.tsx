import FontAwesome from "@expo/vector-icons/FontAwesome";
import { createElement, type ReactNode } from "react";
import { useDropzone } from "react-dropzone";
import { StyleSheet, Text, View } from "react-native";

import { TacticalPalette } from "@/constants/TacticalTheme";

type Props = {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  children: ReactNode;
};

/**
 * Full-bleed drag target for web: dropping anywhere over the Vault (while on My Drive) ingests files.
 * Shows a non-interactive overlay while dragging.
 */
export function VaultFullBleedDropzone({ disabled, onFiles, children }: Props) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    disabled,
    multiple: true,
    noKeyboard: true,
    onDropAccepted: onFiles,
    noDragEventsBubbling: true,
  });

  return (
    <View
      {...(getRootProps() as Record<string, unknown>)}
      style={styles.root}>
      {createElement("input", getInputProps())}
      {children}
      {isDragActive ? (
        <View style={styles.overlay} pointerEvents="none">
          <FontAwesome name="cloud-upload" size={56} color={TacticalPalette.bone} />
          <Text style={styles.overlayTitle}>Drop files to secure in Vault</Text>
          <Text style={styles.overlaySub}>Your files stay private — we never see the originals.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignSelf: "stretch", width: "100%", minHeight: "100%" },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.78)",
    zIndex: 9999,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    gap: 12,
  },
  overlayTitle: {
    color: TacticalPalette.bone,
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
  },
  overlaySub: {
    color: TacticalPalette.boneMuted,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 360,
  },
});
