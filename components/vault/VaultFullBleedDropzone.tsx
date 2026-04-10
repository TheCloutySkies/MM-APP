import type { ReactNode } from "react";
import { View } from "react-native";

type Props = {
  disabled?: boolean;
  onFiles?: (files: File[]) => void;
  children: ReactNode;
};

/** Native: no global drag surface. */
export function VaultFullBleedDropzone({ children }: Props) {
  return <View style={{ flex: 1 }}>{children}</View>;
}
