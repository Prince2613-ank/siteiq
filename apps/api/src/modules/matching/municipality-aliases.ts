/**
 * Narrow, deterministic village/locality → official MA municipality lookup.
 *
 * MassGIS parcel records are keyed by the official municipality name, but
 * real source data often reports a village, neighborhood, or unincorporated
 * locality name instead (client example: "South Deerfield" is a village
 * within the town of Deerfield, not its own municipality — supplying it as
 * the town produced NO_MATCH even though the parcel exists in the mirror).
 *
 * Deliberately NOT a general geographic-name system (client's explicit
 * instruction) — just a small, hand-verified table of well-established MA
 * village/neighborhood → official-town relationships, extended as real data
 * reveals more. Anything not listed here passes through unchanged.
 */
const MUNICIPALITY_ALIASES: Record<string, string> = {
  'south deerfield': 'deerfield',
  'jamaica plain': 'boston',
  roxbury: 'boston',
  dorchester: 'boston',
  'hyde park': 'boston',
  mattapan: 'boston',
  charlestown: 'boston',
  brighton: 'boston',
  allston: 'boston',
  'west roxbury': 'boston',
  roslindale: 'boston',
  wollaston: 'quincy',
  whitinsville: 'northbridge',
};

/** Lowercased, trimmed official municipality name for `name` — resolves a
 * known alias, otherwise returns `name` unchanged (lowercased/trimmed). */
export function resolveMunicipalityAlias(name: string): string {
  const key = name.trim().toLowerCase();
  return MUNICIPALITY_ALIASES[key] ?? key;
}
