import mil from "milsymbol";

/**
 * milsymbol exposes the class as `default.Symbol`. A named `{ Symbol }` import breaks on Hermes /
 * Metro because it resolves to the built-in `Symbol` instead of the library constructor.
 */
const MilSymbol = mil.Symbol;

export type TacticalAffiliation = "friendly" | "hostile" | "neutral" | "unknown";
export type TacticalUnitType = "infantry" | "medical" | "supply" | "vehicle" | "cache" | "unknown";

/**
 * Maps friendly UI choices → MIL-STD-2525C-style symbol strings (milsymbol / Spatial Illusions).
 * 15-character SIDC-style codes (Warfighting / Ground unit / affiliation + echelon slot).
 */
export function tacticalChoicesToSIDC(aff: TacticalAffiliation, unit: TacticalUnitType): string {
  const affLetter =
    aff === "friendly" ? "F" : aff === "hostile" ? "H" : aff === "neutral" ? "N" : "U";
  const base = `S${affLetter}GPU`;
  switch (unit) {
    case "infantry":
      return `${base}CI----***G`;
    case "medical":
      return `${base}CEM---***G`;
    case "supply":
      return `${base}CSA---***G`;
    case "vehicle":
      return `${base}UCA---***G`;
    case "cache":
      return `${base}CSA---***G`;
    case "unknown":
    default:
      return `${base}C-----***G`;
  }
}

export type MilSymbolOptions = {
  sidc: string;
  /** Pixel size passed to milsymbol (scales SVG). */
  size?: number;
  infoFields?: boolean;
};

/** Returns raw SVG markup suitable for `L.divIcon` html (wrap in sized div). */
export function generateTacticalSymbolSvg({ sidc, size = 42, infoFields = false }: MilSymbolOptions): string {
  const sym = new MilSymbol(sidc, { size, infoFields });
  return sym.asSVG();
}

/** Anchor roughly at symbol center for Leaflet divIcon. */
export function milSymbolIconSize(sidc: string, size: number): { w: number; h: number; ax: number; ay: number } {
  const sym = new MilSymbol(sidc, { size, infoFields: false });
  const { width, height } = sym.getSize();
  return { w: width, h: height, ax: Math.round(width / 2), ay: Math.round(height / 2) };
}
