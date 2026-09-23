/**
 * Weighted multi-signal confidence scoring — docs/02 §2.1.
 *
 * No single signal proves an address (client's explicit KT §7 rule). Lot
 * size and zoning are deliberately NOT signals here — they're shown as
 * secondary context in the UI, never fed into this score.
 */

export const DEFAULT_WEIGHTS = {
  addressSimilarity: 0.4,
  distance: 0.3,
  parcelIdMatch: 0.2,
  municipalityMatch: 0.1,
  /// Point-in-parcel containment — a strong signal when a coordinate is
  /// available (client requirement, location-based identification), but
  /// only ever present alongside a coordinate; address-only matches never
  /// compute it, so existing address-match confidence scores are unaffected
  /// (see scoring.spec.ts regression cases).
  pointInParcel: 0.5,
  /// Bigram similarity between a supplied street/location clue (no house
  /// number required) and the candidate's street BASE name (suffix
  /// excluded — see streetSuffixMatch below). Distinct from
  /// addressSimilarity, which compares a FULL address. Only computed when a
  /// bare location clue (not a full address) was supplied.
  locationTextSimilarity: 0.25,
  /// House number extracted from the clue vs. the candidate's own house
  /// number — a strong, specific signal (client requirement: "73 Granite
  /// Ave" must not score the same as "Granite Ave"). Only present when
  /// BOTH sides have a parseable house number.
  houseNumberMatch: 0.5,
  /// Do the clue's and candidate's street SUFFIXES agree (Ave vs. Ave), as
  /// opposed to the base name alone (client requirement: "Creamery Ave"
  /// must not be treated as equivalent to "Creamery Lane" just because they
  /// share "Creamery"). Only present when both sides have a recognized
  /// suffix.
  streetSuffixMatch: 0.2,
};

/**
 * When a candidate's ENTIRE confidence rests on distance/containment/
 * municipality — no house number, no street-name clue, no full-address
 * comparison at all — that confidence is capped below the "high"
 * confidence band, however tight the coordinate match is (client's
 * mandatory rule: a coordinate identifies A nearby parcel, not
 * confirmed identity, without some corroborating address evidence).
 */
export const NO_ADDRESS_CORROBORATION_CONFIDENCE_CAP = 70;

/**
 * Applied when spatial evidence (distance/containment) and address/house-
 * number evidence disagree about which candidate is correct — client's
 * conflict-detection requirement. Lower than the no-corroboration cap
 * because this isn't just "missing evidence," it's evidence that actively
 * disagrees.
 */
export const CONFLICT_CONFIDENCE_CAP = 65;

/**
 * Applied when a SINGLE candidate's own address evidence actively
 * CONTRADICTS its spatial evidence (a mismatched house number or street
 * suffix), not merely lacks it. Client's explicit principle after the
 * Buckland review: "spatial proximity identifies the location; address/
 * property evidence identifies the property" — point-in-parcel containment
 * is strong spatial evidence, but it is NOT sufficient identity evidence,
 * and must not be allowed to outweigh a real contradiction by sheer
 * weight. Same cap value as CONFLICT_CONFIDENCE_CAP (both mean "evidence
 * disagrees"), kept as a separate named export because they're
 * conceptually distinct: this is a contradiction WITHIN one candidate;
 * CONFLICT_CONFIDENCE_CAP is a disagreement BETWEEN two candidates.
 */
export const ADDRESS_CONTRADICTION_CONFIDENCE_CAP = 65;

export const DEFAULT_SEARCH_RADIUS_METERS = 150;

/**
 * Stage-2 radius for the adaptive search (client requirement after the
 * Milton review): when a clue supplies a house number but nothing within
 * DEFAULT_SEARCH_RADIUS_METERS confirms it, the search expands once to
 * this radius before giving up. Deliberately a second explicit stage, not
 * a single larger default — most lookups should stay tightly scoped; only
 * ones that genuinely lack corroboration nearby pay the cost of a wider,
 * noisier search. Configurable here, not hard-coded per municipality.
 */
export const EXPANDED_SEARCH_RADIUS_METERS = 500;
/** Candidate limit for the stage-2 expanded search — wider radius needs a
 * higher limit or a genuinely far match can still be crowded out by
 * closer, irrelevant parcels. */
export const EXPANDED_SEARCH_LIMIT = 20;

export const CONFIDENCE_BANDS = {
  highConfidence: 90,
  needsReview: 60,
} as const;

export type EvidenceStrength = 'strong' | 'medium' | 'weak' | 'none';

export interface CandidateSignals {
  /** 0–1 trigram/string similarity, or null if no address was supplied to compare */
  addressSimilarity: number | null;
  /** meters from the supplied/geocoded point to the candidate, or null if no coordinate available */
  distanceMeters: number | null;
  parcelIdMatch: boolean | null; // null = no parcel ID was supplied at all
  municipalityMatch: boolean | null; // null = no municipality/ZIP was supplied to compare
  /** true if the supplied coordinate falls inside this candidate's parcel geometry; null if no coordinate was supplied */
  pointInParcel: boolean | null;
  /** 0–1 bigram similarity between a bare street/location clue's BASE name (suffix excluded) and the candidate's street base name; null if no such clue was supplied */
  locationTextSimilarity: number | null;
  /** true/false if BOTH the clue and the candidate have a parseable house number; null if either side lacks one */
  houseNumberMatch: boolean | null;
  /** true/false if BOTH the clue and the candidate have a recognized street suffix; null if either side lacks one */
  streetSuffixMatch: boolean | null;
}

export interface ScoredCandidate {
  confidence: number; // 0–100, rounded
  evidence: {
    addressSimilarity: number | null;
    distanceMeters: number | null;
    distanceScore: number | null;
    parcelIdMatch: boolean | null;
    municipalityMatch: boolean | null;
    pointInParcel: boolean | null;
    locationTextSimilarity: number | null;
    houseNumberMatch: boolean | null;
    streetSuffixMatch: boolean | null;
    /** true when confidence was capped because no address-family evidence
     * (house number, street-name clue, or full address) corroborated a
     * purely coordinate-driven match — client-mandated transparency flag,
     * drives the "Low corroboration" message on Candidate Review. */
    lowCorroboration: boolean;
    /** true when this candidate's own spatial evidence and a DIFFERENT
     * candidate's address/house-number evidence point at different
     * parcels. Set after scoring, across the whole candidate set (see
     * MatchingService) — always present so downstream code doesn't need to
     * guard against an undefined field. */
    conflictDetected: boolean;
    conflictingCandidateParcelRef: string | null;
    /** Round 4 alias of conflictDetected, specifically for the cross-search
     * (address-family search vs. spatial search) case — client's exact
     * requested field name. Same underlying mechanism, set together. */
    identityEvidenceConflict: boolean;
    /** Descriptive evidence-strength labels (client's evidence-hierarchy
     * model) — transparency only, NEVER fed back into the confidence
     * formula itself, so changing how these are labeled can't silently
     * change a score. 'none' = this evidence type wasn't available at all. */
    addressEvidenceStrength: EvidenceStrength;
    spatialEvidenceStrength: EvidenceStrength;
    /** True spatial evidence is strong for THIS candidate (contained by
     * the coordinate, or very close) — descriptive only, never on its own
     * evidence of correct identity (client's evidence-hierarchy rule). */
    spatialEvidenceStrong: boolean;
    /** True when this candidate's OWN address evidence actively
     * contradicts its spatial evidence (mismatched house number or street
     * suffix) — distinct from simply lacking address evidence. Confidence
     * is capped when this is true (see ADDRESS_CONTRADICTION_CONFIDENCE_CAP). */
    addressEvidenceConflict: boolean;
    /** Convenience flag for the UI: true whenever ANY of lowCorroboration,
     * addressEvidenceConflict, or conflictDetected apply to this candidate
     * — "don't trust this number without a human looking at it," in one
     * field the Candidate Review screen can check without re-deriving the
     * logic. */
    manualVerificationRequired: boolean;
  };
}

function distanceScore(meters: number | null, radius: number): number | null {
  if (meters === null) return null;
  if (meters >= radius) return 0;
  return 1 - meters / radius;
}

/**
 * Combines available signals into one 0–100 confidence score. Signals that
 * weren't available for this lookup (their weight) redistribute
 * proportionally across the signals that WERE available, rather than
 * counting as zero — a coordinates-only lookup isn't penalized for lacking
 * an address to compare against (docs/02 §2.1).
 */
export function scoreCandidate(
  signals: CandidateSignals,
  radiusMeters: number = DEFAULT_SEARCH_RADIUS_METERS,
  weights = DEFAULT_WEIGHTS,
): ScoredCandidate {
  const distScore = distanceScore(signals.distanceMeters, radiusMeters);

  const available: { key: keyof typeof weights; value: number }[] = [];
  if (signals.addressSimilarity !== null) {
    available.push({ key: 'addressSimilarity', value: signals.addressSimilarity });
  }
  if (distScore !== null) {
    available.push({ key: 'distance', value: distScore });
  }
  if (signals.parcelIdMatch !== null) {
    available.push({ key: 'parcelIdMatch', value: signals.parcelIdMatch ? 1 : 0 });
  }
  if (signals.municipalityMatch !== null) {
    available.push({ key: 'municipalityMatch', value: signals.municipalityMatch ? 1 : 0 });
  }
  if (signals.pointInParcel !== null) {
    available.push({ key: 'pointInParcel', value: signals.pointInParcel ? 1 : 0 });
  }
  if (signals.locationTextSimilarity !== null) {
    available.push({ key: 'locationTextSimilarity', value: signals.locationTextSimilarity });
  }
  if (signals.houseNumberMatch !== null) {
    available.push({ key: 'houseNumberMatch', value: signals.houseNumberMatch ? 1 : 0 });
  }
  if (signals.streetSuffixMatch !== null) {
    available.push({ key: 'streetSuffixMatch', value: signals.streetSuffixMatch ? 1 : 0 });
  }

  let confidence = 0;
  if (available.length > 0) {
    const totalWeight = available.reduce((sum, s) => sum + weights[s.key], 0);
    const weightedSum = available.reduce((sum, s) => sum + weights[s.key] * s.value, 0);
    confidence = totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 0;
  }

  // Corroboration floor (client-mandated): distance + containment +
  // municipality alone — with NO house number, street-name clue, or full
  // address comparison at all — describe A parcel at that point, not a
  // confirmed identity. Cap below the "high" band regardless of how tight
  // the coordinate match is.
  const hasAddressFamilyEvidence =
    signals.addressSimilarity !== null ||
    signals.locationTextSimilarity !== null ||
    signals.houseNumberMatch !== null ||
    signals.parcelIdMatch !== null;
  const lowCorroboration = !hasAddressFamilyEvidence;
  if (lowCorroboration) {
    confidence = Math.min(confidence, NO_ADDRESS_CORROBORATION_CONFIDENCE_CAP);
  }

  // Client's evidence-hierarchy rule (post-Buckland-review): point-in-
  // parcel/distance is strong SPATIAL evidence, but never sufficient
  // IDENTITY evidence on its own. When this candidate's own house number
  // or street suffix actively CONTRADICTS the clue (not merely lacks a
  // clue to compare against), that contradiction must materially reduce
  // confidence — capped, regardless of how strong the spatial signal is.
  const addressEvidenceConflict = signals.houseNumberMatch === false || signals.streetSuffixMatch === false;
  if (addressEvidenceConflict) {
    confidence = Math.min(confidence, ADDRESS_CONTRADICTION_CONFIDENCE_CAP);
  }

  const spatialEvidenceStrong = signals.pointInParcel === true || (distScore !== null && distScore > 0.7);

  // Evidence-hierarchy strength labels (client's model) — descriptive
  // only, computed from the same signals already scored above, never fed
  // back into `confidence`. A contradiction (houseNumberMatch/
  // streetSuffixMatch === false) is 'weak', not 'medium' — it's already
  // capped via addressEvidenceConflict above, and calling it "medium"
  // would undersell that it's actively wrong, not just unconfirmed.
  const addressEvidenceStrength: EvidenceStrength =
    signals.houseNumberMatch === true && signals.streetSuffixMatch !== false
      ? 'strong'
      : addressEvidenceConflict
        ? 'weak'
        : signals.streetSuffixMatch === true || (signals.locationTextSimilarity !== null && signals.locationTextSimilarity > 0.6) || signals.addressSimilarity === 1
          ? 'medium'
          : signals.locationTextSimilarity !== null || signals.addressSimilarity !== null
            ? 'weak'
            : 'none';

  const spatialEvidenceStrength: EvidenceStrength =
    signals.pointInParcel === true
      ? 'strong'
      : distScore !== null && distScore > 0.7
        ? 'strong'
        : distScore !== null && distScore > 0.3
          ? 'medium'
          : distScore !== null
            ? 'weak'
            : 'none';

  return {
    confidence: Math.round(confidence),
    evidence: {
      addressSimilarity: signals.addressSimilarity,
      distanceMeters: signals.distanceMeters,
      distanceScore: distScore,
      parcelIdMatch: signals.parcelIdMatch,
      municipalityMatch: signals.municipalityMatch,
      pointInParcel: signals.pointInParcel,
      locationTextSimilarity: signals.locationTextSimilarity,
      houseNumberMatch: signals.houseNumberMatch,
      streetSuffixMatch: signals.streetSuffixMatch,
      lowCorroboration,
      conflictDetected: false,
      conflictingCandidateParcelRef: null,
      identityEvidenceConflict: false,
      spatialEvidenceStrong,
      addressEvidenceConflict,
      manualVerificationRequired: lowCorroboration || addressEvidenceConflict,
      addressEvidenceStrength,
      spatialEvidenceStrength,
    },
  };
}

export type ConfidenceBand = 'high' | 'needs_review' | 'no_match';

export function bandFor(confidence: number): ConfidenceBand {
  if (confidence >= CONFIDENCE_BANDS.highConfidence) return 'high';
  if (confidence >= CONFIDENCE_BANDS.needsReview) return 'needs_review';
  return 'no_match';
}
