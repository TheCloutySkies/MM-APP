/**
 * Remote verification: four memorable words derived from both parties' public keys.
 * Same inputs (sorted SPKI base64 strings) produce the same phrase for both users.
 */

import { utf8 } from "@/lib/crypto/bytes";

/** Exactly 256 short, distinct, easy-to-read words (indices 0–255). */
export const SECURITY_WORDS_256: readonly string[] = [
  "acorn", "anchor", "apache", "archer", "arctic", "aster", "atlas", "aurora", "avalon", "badger",
  "ballet", "bamboo", "banner", "barley", "basil", "battery", "bayou", "beacon", "bear", "beaver",
  "bench", "birch", "blade", "blizzard", "boulder", "branch", "breeze", "brewer", "bridge", "bronco",
  "brook", "brush", "buffalo", "budapest", "bullet", "bumble", "bunker", "cactus", "calypso", "camber",
  "candle", "canyon", "carbon", "cargo", "caribou", "cascade", "castle", "cavern", "cedar", "chakra",
  "chamber", "chapel", "chariot", "chestnut", "cider", "cinema", "cinnamon", "citadel", "citizen", "clarion",
  "claymore", "clement", "clover", "cobalt", "comet", "compass", "conga", "corona", "cosmos", "crater",
  "creek", "crescent", "crimson", "crowbar", "crystal", "cypress", "daisy", "deer", "delta", "destiny",
  "diamond", "diesel", "dinghy", "district", "diving", "dock", "dolphin", "domain", "dragon", "driver",
  "durango", "eagle", "echo", "eden", "eiffel", "elbrus", "element", "ember", "emerald", "engine",
  "epoch", "equinox", "falcon", "fathom", "fennel", "ferris", "finch", "firefly", "fjord", "fleet",
  "flint", "flora", "fluent", "fuchsia", "galaxy", "gambit", "garden", "garfield", "gateway", "geyser",
  "gibbon", "glacier", "gnome", "granite", "grotto", "grove", "guava", "harbor", "harvest", "havana",
  "havoc", "hawkeye", "mesa", "helium", "herald", "heron", "hickory", "horizon", "hunter", "hydrant",
  "hyena", "ibex", "iceberg", "icon", "igloo", "impala", "indigo", "iris", "isotope", "jade",
  "jaguar", "jalopy", "javelin", "jetty", "jigsaw", "juniper", "kafka", "keystone", "kilo", "kimono",
  "kingdom", "kiwi", "kodiak", "lagoon", "lambda", "lantern", "larva", "lasso", "latitude", "lava",
  "legend", "lemon", "liberty", "lilac", "linear", "lion", "lotus", "lumber", "lynx", "macaw",
  "magnet", "magpie", "malibu", "mamba", "mammoth", "manatee", "mantle", "marble", "matrix", "maverick",
  "maxim", "mayan", "medley", "mercury", "mermaid", "meteor", "midnight", "mitten", "module", "mojave",
  "monarch", "monsoon", "mosaic", "mulberry", "mustang", "nautilus", "nectar", "nelson", "nebula", "nemesis",
  "nest", "nightjar", "nimbus", "nomad", "nova", "oasis", "ocelot", "octagon", "odin", "olive",
  "olympic", "omega", "opal", "orbit", "orca", "orchid", "origami", "oriole", "otter", "outpost",
  "oxford", "oxide", "oyster", "pacific", "paddle", "pagoda", "painter", "paladin", "palm", "panda",
  "pangea", "panther", "paper", "paradox", "paragon", "parmesan", "pastel", "patriot", "pebble", "pegasus",
  "pelican", "penguin", "phoenix", "pickle", "pilot", "pine"
] as const;

if (SECURITY_WORDS_256.length !== 256) {
  throw new Error(`SECURITY_WORDS_256 must have 256 entries (has ${SECURITY_WORDS_256.length})`);
}

/** Four lowercase words, hyphenated for display (e.g. "eagle-river-mesa-fjord"). */
export async function securityPhraseFromSpkiPair(mySpkiB64: string, theirSpkiB64: string): Promise<string[]> {
  const sorted = [mySpkiB64.trim(), theirSpkiB64.trim()].sort((a, b) => a.localeCompare(b));
  const input = utf8(`${sorted[0]}|${sorted[1]}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input as BufferSource));
  const words: string[] = [];
  for (let i = 0; i < 4; i++) {
    words.push(SECURITY_WORDS_256[digest[i]!]!);
  }
  return words;
}

export function formatSecurityPhrase(words: string[]): string {
  return words.map((w) => w.toUpperCase()).join(" — ");
}
