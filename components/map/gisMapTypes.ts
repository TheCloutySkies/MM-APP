/** Live measure segment (first point + cursor) — not persisted in GeoJSON. */
export type MeasurePreview = {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number } | null;
  /** When set, overrides `gisPalette.measure` for this preview. */
  color?: string;
};

export type GisDrawPalette = {
  bufferStroke: string;
  bufferFill: string;
  lineString: string;
  polygonStroke: string;
  polygonFill: string;
  measure: string;
};
