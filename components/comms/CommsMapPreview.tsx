import type { StyleProp, ViewStyle } from "react-native";
import MapView, { Marker } from "react-native-maps";

/** Native map preview; web uses `CommsMapPreview.web.tsx`. */
export function CommsMapPreview({
  lat,
  lng,
  style,
}: {
  lat: number;
  lng: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <MapView
      style={style}
      scrollEnabled={false}
      zoomTapEnabled={false}
      zoomEnabled={false}
      pitchEnabled={false}
      rotateEnabled={false}
      region={{
        latitude: lat,
        longitude: lng,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      }}>
      <Marker coordinate={{ latitude: lat, longitude: lng }} />
    </MapView>
  );
}
