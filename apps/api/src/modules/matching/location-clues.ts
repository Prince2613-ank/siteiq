/**
 * Deterministic clue extraction from free-text location descriptions —
 * regex/token based, NOT a natural-language interpretation engine (client's
 * explicit instruction). Handles the common surveyor/maintenance-log shape
 * this dataset uses, e.g.:
 *
 *   "0.25 mi S of Methuen-Lawrence TL on Marston St"
 *     -> { streetHint: "Marston St", distanceMiles: 0.25, direction: "S",
 *          landmark: "Methuen-Lawrence TL" }
 *
 * This is supporting evidence only (client's correction) — the street/
 * location field supplied directly by the caller is always preferred over
 * anything parsed here; parsing exists as a fallback and for transparency
 * in the evidence shown on Candidate Review.
 */
import { isKnownSuffixToken } from './address-normalizer';

export interface LocationClues {
  /** Street/location name parsed from an " on <street>" fragment, if present. */
  streetHint: string | null;
  distanceMiles: number | null;
  /** N, S, E, W, NE, NW, SE, or SW */
  direction: string | null;
  /** Reference point parsed from an " of <landmark>" fragment, if present. */
  landmark: string | null;
}

const DISTANCE_DIRECTION_RE = /(\d+(?:\.\d+)?)\s*mi(?:les?)?\.?\s+(NE|NW|SE|SW|N|S|E|W)\b/i;
const ON_STREET_RE = /\bon\s+([A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,3})\s*$/i;
const OF_LANDMARK_RE = /\bof\s+(.+?)(?:\s+\bon\b|$)/i;
const MAX_BARE_STREET_WORDS = 6;
const MAX_LEADING_STREET_WORDS = 4;

export function extractLocationClues(description: string | null | undefined): LocationClues {
  if (!description || !description.trim()) {
    return { streetHint: null, distanceMiles: null, direction: null, landmark: null };
  }
  const text = description.trim();

  let distanceMiles: number | null = null;
  let direction: string | null = null;
  const distMatch = text.match(DISTANCE_DIRECTION_RE);
  if (distMatch) {
    distanceMiles = Number.parseFloat(distMatch[1]);
    direction = distMatch[2].toUpperCase();
  }

  let streetHint: string | null = null;
  const onMatch = text.match(ON_STREET_RE);
  if (onMatch) {
    streetHint = onMatch[1].trim();
  } else {
    // No "on <street>" phrasing — check whether the description is ITSELF
    // just a bare street name (e.g. "Chocksett Road", "Boston Road"), with
    // no distance/direction grammar at all. Deterministic dictionary
    // lookup (does the last word end in a recognized street suffix?), not
    // free-form interpretation — same rule for every MA town.
    const beforeParen = text.split('(')[0].trim();
    const words = beforeParen.split(/\s+/).filter(Boolean);
    if (
      words.length > 0 &&
      words.length <= MAX_BARE_STREET_WORDS &&
      isKnownSuffixToken(words[words.length - 1])
    ) {
      streetHint = beforeParen;
    } else {
      // Still nothing — check whether the description LEADS with a street
      // name before trailing off into route/junction description (e.g.
      // "Clark Rd Tewksbury Rts 38 & 495"). Same dictionary-lookup rule,
      // just applied to the start of the text instead of requiring the
      // whole string to be the street name. Bounded to the first few words
      // to avoid picking up an unrelated suffix-like word deep in the
      // sentence.
      const leadingSuffixIdx = words.slice(0, MAX_LEADING_STREET_WORDS).findIndex(isKnownSuffixToken);
      if (leadingSuffixIdx > 0) {
        streetHint = words.slice(0, leadingSuffixIdx + 1).join(' ');
      }
    }
  }

  let landmark: string | null = null;
  const ofMatch = text.match(OF_LANDMARK_RE);
  if (ofMatch) {
    landmark = ofMatch[1].trim().replace(/[.,]$/, '');
  }

  return { streetHint, distanceMiles, direction, landmark };
}
