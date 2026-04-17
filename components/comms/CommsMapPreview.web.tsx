import type { StyleProp, ViewStyle } from "react-native";
import { Image } from "react-native";

function staticMapUri(lat: number, lng: number): string {
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=15&size=280x140&markers=${lat},${lng},red-pushpin`;
}

export function CommsMapPreview({
  lat,
  lng,
  style,
}: {
  lat: number;
  lng: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <Image source={{ uri: staticMapUri(lat, lng) }} style={style} resizeMode="cover" />;
}
