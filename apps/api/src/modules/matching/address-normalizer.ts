/**
 * Lightweight, dependency-free address normalizer for MA street addresses.
 *
 * KNOWN LIMITATION (flagged in docs/05): this is a regex/token-based
 * normalizer, not a full address-parsing library (e.g. libpostal, which
 * needs a native binary dependency risky to add sight-unseen in this
 * session). It handles the common cases this checkpoint's acceptance flow
 * calls for — case/whitespace, common street-suffix abbreviations, and
 * splitting off a city/state/zip tail — but will not handle every rural or
 * non-standard MA address correctly. Isolated behind this one module so a
 * stronger parser can replace it later without touching the matching
 * pipeline that calls it.
 */

export interface NormalizedAddress {
  raw: string;
  houseNumber: string | null;
  /** A second house number on a combined-parcel listing (e.g. "410 412
   * Granite Ave" — two addresses, one MassGIS row). Real, observed data
   * (Milton), not a hypothetical. Null unless a second bare number
   * immediately follows the first. */
  houseNumber2: string | null;
  /** Parsed [start, end] when the leading token is a hyphenated range
   * (e.g. "7-9 Chocksett Road", "15-21 Chocksett Road" — both real
   * Sterling data). Null otherwise. */
  houseNumberRange: [number, number] | null;
  streetName: string | null;
  /** houseNumber + streetName, normalized — what we compare against the mirror */
  streetLine: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

const SUFFIX_MAP: Record<string, string> = {
  street: 'st', str: 'st', st: 'st',
  avenue: 'ave', av: 'ave', ave: 'ave',
  road: 'rd', rd: 'rd',
  drive: 'dr', dr: 'dr',
  lane: 'ln', ln: 'ln',
  way: 'way',
  boulevard: 'blvd', blvd: 'blvd',
  court: 'ct', ct: 'ct',
  place: 'pl', pl: 'pl',
  circle: 'cir', cir: 'cir',
  terrace: 'ter', ter: 'ter',
  parkway: 'pkwy', pkwy: 'pkwy',
  highway: 'hwy', hwy: 'hwy',
  turnpike: 'tpke', tpke: 'tpke',
  trail: 'trl', trl: 'trl',
  extension: 'ext', ext: 'ext',
};

/** The canonical abbreviations SUFFIX_MAP normalizes TO — used to tell a
 * genuine street suffix apart from an ordinary word once normalized. */
const KNOWN_SUFFIX_CODES = new Set(Object.values(SUFFIX_MAP));

function normalizeSuffix(token: string): string {
  const key = token.toLowerCase().replace(/\.$/, '');
  return SUFFIX_MAP[key] ?? key;
}

/** Is `token` recognized as a street-suffix word (in any of its forms —
 * "Street", "St", "St.")? Distinct from normalizeSuffix, which always
 * returns SOMETHING even for a word that isn't a suffix at all. */
export function isKnownSuffixToken(token: string): boolean {
  const key = token.toLowerCase().replace(/\.$/, '');
  return key in SUFFIX_MAP;
}

/**
 * Splits an already-normalized `streetName` (e.g. "creamery ave") into its
 * base name and suffix — but ONLY if the last word is a recognized suffix
 * code. Used to compare street names and suffixes independently (client
 * requirement: "Creamery Ave" must not be treated as equivalent to
 * "Creamery Lane" just because they share a base word).
 */
export function splitStreetNameAndSuffix(streetName: string | null): { base: string | null; suffix: string | null } {
  if (!streetName) return { base: null, suffix: null };
  const words = streetName.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { base: null, suffix: null };
  const last = words[words.length - 1];
  if (words.length > 1 && KNOWN_SUFFIX_CODES.has(last)) {
    return { base: words.slice(0, -1).join(' '), suffix: last };
  }
  return { base: streetName, suffix: null };
}

/**
 * "142 Elm Street, Worcester, MA 01609" ->
 *   { houseNumber: "142", streetName: "elm st", streetLine: "142 elm st",
 *     city: "worcester", state: "MA", zip: "01609" }
 *
 * Also handles a bare street line with no city ("142 Elm St") and a
 * city-only fragment with no house number ("Elm St, Worcester") — both
 * come back with the fields that could be extracted and `null` elsewhere,
 * never a thrown error, since KT §5 requires SiteIQ to keep trying rather
 * than reject imperfect input outright.
 */
export function normalizeAddress(input: string): NormalizedAddress {
  const raw = input.trim();
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);

  const streetPart = parts[0] ?? '';
  let city: string | null = null;
  let state: string | null = null;
  let zip: string | null = null;

  if (parts.length >= 2) {
    city = parts[1] || null;
  }
  if (parts.length >= 3) {
    const stateZip = parts[2].trim();
    const match = stateZip.match(/^([A-Za-z]{2})?\s*(\d{5})?/);
    if (match) {
      state = match[1]?.toUpperCase() || null;
      zip = match[2] || null;
    }
  } else if (parts.length === 2) {
    // "142 Elm St, Worcester MA 01609" (no third comma-separated segment)
    const trailing = parts[1].match(/^(.*?)(?:\s+([A-Za-z]{2}))?\s*(\d{5})?$/);
    if (trailing) {
      city = trailing[1]?.trim() || city;
      state = trailing[2]?.toUpperCase() || state;
      zip = trailing[3] || zip;
    }
  }

  const tokens = streetPart.split(/\s+/).filter(Boolean);
  let houseNumber: string | null = null;
  let houseNumber2: string | null = null;
  let houseNumberRange: [number, number] | null = null;
  let streetTokens = tokens;
  const rangeMatch = tokens.length > 0 ? tokens[0].match(/^(\d+)-(\d+)$/) : null;
  if (rangeMatch) {
    houseNumber = tokens[0];
    houseNumberRange = [Number.parseInt(rangeMatch[1], 10), Number.parseInt(rangeMatch[2], 10)];
    streetTokens = tokens.slice(1);
  } else if (tokens.length > 0 && /^\d+[A-Za-z]?$/.test(tokens[0])) {
    houseNumber = tokens[0];
    streetTokens = tokens.slice(1);
    // Combined-parcel listing: a second bare number immediately follows
    // (e.g. "410 412 Granite Ave" — real Milton data, one MassGIS row
    // covering two addresses).
    if (streetTokens.length > 0 && /^\d+[A-Za-z]?$/.test(streetTokens[0])) {
      houseNumber2 = streetTokens[0];
      streetTokens = streetTokens.slice(1);
    }
  }

  // A real address always ends with its suffix, so this normally does
  // nothing — but a messy location clue can carry trailing text AFTER the
  // real street suffix (e.g. "73 Granite Ave adj SE Expressway .02 mil S
  // Bosto"). If the LAST token isn't a recognized suffix, but an earlier
  // one is, truncate there rather than treating the whole trailing mess as
  // part of the street name. General cleanup, not specific to any town.
  if (streetTokens.length > 1 && !isKnownSuffixToken(streetTokens[streetTokens.length - 1])) {
    const suffixIdx = streetTokens.findIndex(isKnownSuffixToken);
    if (suffixIdx !== -1) {
      streetTokens = streetTokens.slice(0, suffixIdx + 1);
    }
  }

  const streetName =
    streetTokens.length > 0
      ? streetTokens
          .map((t, i) => (i === streetTokens.length - 1 ? normalizeSuffix(t) : t.toLowerCase()))
          .join(' ')
      : null;

  const streetLine =
    houseNumber && streetName
      ? `${houseNumber} ${streetName}`
      : streetName
        ? streetName
        : null;

  return { raw, houseNumber, houseNumber2, houseNumberRange, streetName, streetLine, city, state, zip };
}

/**
 * Compares a clue's house number against a candidate's — accounting for
 * the real MA parcel-mirror patterns found during Round 4 review:
 * hyphenated ranges ("7-9 Chocksett Road") and combined-parcel double
 * numbers ("410 412 Granite Ave"). Null when either side has no house
 * number to compare (same "missing vs. contradicting" distinction as
 * every other signal in this pipeline — see ADR-0007).
 */
export function houseNumbersMatch(clue: NormalizedAddress, candidate: NormalizedAddress): boolean | null {
  if (!clue.houseNumber) return null;
  if (!candidate.houseNumber && !candidate.houseNumberRange) return null;

  const clueNum = Number.parseInt(clue.houseNumber, 10);

  if (candidate.houseNumberRange) {
    const [start, end] = candidate.houseNumberRange;
    return clueNum >= start && clueNum <= end;
  }

  if (candidate.houseNumber === clue.houseNumber) return true;
  if (candidate.houseNumber2 && candidate.houseNumber2 === clue.houseNumber) return true;
  return false;
}
