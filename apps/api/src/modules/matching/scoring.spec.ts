import { bandFor, NO_ADDRESS_CORROBORATION_CONFIDENCE_CAP, scoreCandidate } from './scoring';

const NULL_SIGNALS = {
  addressSimilarity: null,
  distanceMeters: null,
  parcelIdMatch: null,
  municipalityMatch: null,
  pointInParcel: null,
  locationTextSimilarity: null,
  houseNumberMatch: null,
  streetSuffixMatch: null,
};

describe('scoreCandidate', () => {
  it('scores a perfect exact-address match at 100', () => {
    const result = scoreCandidate({
      ...NULL_SIGNALS,
      addressSimilarity: 1,
      municipalityMatch: true,
    });
    expect(result.confidence).toBe(100);
    expect(bandFor(result.confidence)).toBe('high');
  });

  it('scores a direct parcel-ID resolution (no address given) at 100 on that signal alone', () => {
    const result = scoreCandidate({
      ...NULL_SIGNALS,
      parcelIdMatch: true,
    });
    expect(result.confidence).toBe(100);
  });

  it('does not let a single weak signal alone produce a high-confidence score', () => {
    // Only address similarity available, and it's mediocre — nothing else
    // corroborates it. Per KT §7: no single signal proves an address.
    const result = scoreCandidate({
      ...NULL_SIGNALS,
      addressSimilarity: 0.5,
    });
    expect(result.confidence).toBe(50);
    expect(bandFor(result.confidence)).toBe('no_match');
  });

  it('redistributes weight when a signal is unavailable rather than penalizing to zero', () => {
    // Coordinates-only lookup: address similarity signal doesn't exist at
    // all (not zero) — should not be treated as if the address failed to
    // match. (addressSimilarity stays null here deliberately, to isolate
    // the redistribution behavior — see the "low corroboration" tests
    // below for what happens once the corroboration floor applies too.)
    const perfectDistanceOnly = scoreCandidate({
      ...NULL_SIGNALS,
      distanceMeters: 0,
      houseNumberMatch: true, // gives it address-family corroboration so the floor doesn't mask the redistribution behavior being tested
    });
    expect(perfectDistanceOnly.confidence).toBe(100);
  });

  it('scores a far-away candidate outside the radius at 0 for the distance signal', () => {
    const result = scoreCandidate(
      { ...NULL_SIGNALS, distanceMeters: 500, houseNumberMatch: true },
      150,
    );
    expect(result.evidence.distanceScore).toBe(0);
  });

  it('combines multiple weak-to-moderate signals into a mid-confidence, needs-review score', () => {
    const result = scoreCandidate({
      ...NULL_SIGNALS,
      addressSimilarity: 0.7,
      distanceMeters: 100,
      municipalityMatch: true,
    });
    expect(bandFor(result.confidence)).toBe('needs_review');
  });

  it('lot size and zoning are never accepted as scoring inputs (type-level guarantee)', () => {
    // CandidateSignals has exactly eight keys; this test documents that
    // guarantee so a future change adding a `lotSizeMatch` signal here
    // would have to consciously violate KT §7, not slip in silently.
    const result = scoreCandidate({ ...NULL_SIGNALS, addressSimilarity: 1 });
    expect(Object.keys(result.evidence).sort()).toEqual(
      [
        'addressSimilarity',
        'distanceMeters',
        'distanceScore',
        'municipalityMatch',
        'parcelIdMatch',
        'pointInParcel',
        'locationTextSimilarity',
        'houseNumberMatch',
        'streetSuffixMatch',
        'lowCorroboration',
        'conflictDetected',
        'conflictingCandidateParcelRef',
        'spatialEvidenceStrong',
        'addressEvidenceConflict',
        'manualVerificationRequired',
        'identityEvidenceConflict',
        'addressEvidenceStrength',
        'spatialEvidenceStrength',
      ].sort(),
    );
  });

  // --- Regression: existing address-only scores must be byte-for-byte
  // unchanged now that the coordinate-clue signals exist — they must stay
  // null (excluded from the weighted formula) for every case above that
  // never supplies a coordinate/clue.
  it('regression: an address-only match ignores the new coordinate-clue signals entirely', () => {
    const withNewSignalsNull = scoreCandidate({
      ...NULL_SIGNALS,
      addressSimilarity: 0.82,
      municipalityMatch: true,
    });
    // Same formula as if those keys didn't exist: only addressSimilarity
    // (0.4) and municipalityMatch (0.1) are "available".
    const expected = Math.round(((0.4 * 0.82 + 0.1 * 1) / (0.4 + 0.1)) * 100);
    expect(withNewSignalsNull.confidence).toBe(expected);
  });

  it('point-in-parcel containment alone is a strong signal, but capped by the corroboration floor since nothing else corroborates it', () => {
    const result = scoreCandidate({
      ...NULL_SIGNALS,
      distanceMeters: 30,
      municipalityMatch: true,
      pointInParcel: true,
    });
    // Client's mandatory rule: distance + containment + municipality alone
    // must never reach the "high" band, however tight the coordinate.
    expect(result.confidence).toBeLessThanOrEqual(NO_ADDRESS_CORROBORATION_CONFIDENCE_CAP);
    expect(result.evidence.lowCorroboration).toBe(true);
    expect(bandFor(result.confidence)).not.toBe('high');
  });

  it('a coordinate NOT contained in the candidate parcel scores lower than one that is, all else equal', () => {
    const contained = scoreCandidate({
      ...NULL_SIGNALS,
      distanceMeters: 30,
      municipalityMatch: true,
      pointInParcel: true,
    });
    const notContained = scoreCandidate({
      ...NULL_SIGNALS,
      distanceMeters: 30,
      municipalityMatch: true,
      pointInParcel: false,
    });
    expect(contained.confidence).toBeGreaterThan(notContained.confidence);
  });

  it('a location-text clue contributes as a distinct signal from full address similarity, and lifts the corroboration floor', () => {
    const result = scoreCandidate({
      ...NULL_SIGNALS,
      distanceMeters: 40,
      municipalityMatch: true,
      pointInParcel: true,
      locationTextSimilarity: 0.9,
    });
    expect(result.evidence.locationTextSimilarity).toBe(0.9);
    expect(result.evidence.lowCorroboration).toBe(false);
    expect(result.confidence).toBeGreaterThan(NO_ADDRESS_CORROBORATION_CONFIDENCE_CAP);
  });

  // --- New signals (client-approved corrections after the batch-validation review) ---

  it('a matching house number is a strong positive signal, independent of street-name similarity', () => {
    const withNumber = scoreCandidate({
      ...NULL_SIGNALS,
      distanceMeters: 30,
      pointInParcel: true,
      locationTextSimilarity: 0.8,
      houseNumberMatch: true,
    });
    const withoutNumberClue = scoreCandidate({
      ...NULL_SIGNALS,
      distanceMeters: 30,
      pointInParcel: true,
      locationTextSimilarity: 0.8,
    });
    expect(withNumber.confidence).toBeGreaterThan(withoutNumberClue.confidence);
  });

  it('a mismatched house number pulls confidence down relative to a matching one, all else equal', () => {
    const matching = scoreCandidate({
      ...NULL_SIGNALS,
      distanceMeters: 30,
      pointInParcel: true,
      locationTextSimilarity: 0.9,
      houseNumberMatch: true,
    });
    const mismatched = scoreCandidate({
      ...NULL_SIGNALS,
      distanceMeters: 30,
      pointInParcel: true,
      locationTextSimilarity: 0.9,
      houseNumberMatch: false,
    });
    expect(mismatched.confidence).toBeLessThan(matching.confidence);
  });

  it('a street suffix mismatch pulls confidence down even when the base street name matches well (Creamery Ave vs Creamery Lane)', () => {
    // locationTextSimilarity here represents the BASE-NAME-ONLY similarity
    // (suffix already excluded upstream) — high, because "Creamery" matches
    // "Creamery" exactly. The suffix disagreement is scored separately.
    const suffixMatches = scoreCandidate({
      ...NULL_SIGNALS,
      distanceMeters: 30,
      pointInParcel: true,
      locationTextSimilarity: 1,
      streetSuffixMatch: true,
    });
    const suffixMismatches = scoreCandidate({
      ...NULL_SIGNALS,
      distanceMeters: 30,
      pointInParcel: true,
      locationTextSimilarity: 1,
      streetSuffixMatch: false,
    });
    expect(suffixMismatches.confidence).toBeLessThan(suffixMatches.confidence);
    // Meaningful penalty, not a token gesture.
    expect(suffixMatches.confidence - suffixMismatches.confidence).toBeGreaterThanOrEqual(10);
  });

  // --- Post-Buckland-review corrections: spatial evidence must not be
  // able to outweigh a genuine address contradiction just by sheer weight ---

  it('caps confidence when a strong point-in-parcel match is contradicted by a mismatched street suffix (the Buckland pattern)', () => {
    const result = scoreCandidate({
      ...NULL_SIGNALS,
      distanceMeters: 5, // very close
      pointInParcel: true, // strong spatial evidence
      locationTextSimilarity: 1, // base name matches ("Creamery" = "Creamery")
      streetSuffixMatch: false, // but the suffix contradicts (Lane vs Ave)
    });
    expect(result.evidence.addressEvidenceConflict).toBe(true);
    expect(result.evidence.spatialEvidenceStrong).toBe(true);
    expect(result.evidence.manualVerificationRequired).toBe(true);
    // Client's explicit rule: spatial proximity identifies the location;
    // address evidence identifies the property. A contradiction caps
    // confidence regardless of how strong the spatial signal is.
    expect(result.confidence).toBeLessThanOrEqual(65);
  });

  it('caps confidence when point-in-parcel is contradicted by a mismatched house number', () => {
    const result = scoreCandidate({
      ...NULL_SIGNALS,
      distanceMeters: 2,
      pointInParcel: true,
      houseNumberMatch: false,
    });
    expect(result.evidence.addressEvidenceConflict).toBe(true);
    expect(result.confidence).toBeLessThanOrEqual(65);
  });

  it('does NOT flag a conflict when address evidence is merely absent (not contradictory)', () => {
    const result = scoreCandidate({
      ...NULL_SIGNALS,
      distanceMeters: 5,
      pointInParcel: true,
    });
    expect(result.evidence.addressEvidenceConflict).toBe(false);
    // This case is still flagged via lowCorroboration instead — a
    // different, already-existing mechanism for a different situation
    // (missing evidence vs. contradicting evidence).
    expect(result.evidence.lowCorroboration).toBe(true);
    expect(result.evidence.manualVerificationRequired).toBe(true);
  });

  it('spatialEvidenceStrong reflects containment or a very tight distance, independent of address evidence', () => {
    const contained = scoreCandidate({ ...NULL_SIGNALS, distanceMeters: 100, pointInParcel: true });
    const tightDistanceNotContained = scoreCandidate({ ...NULL_SIGNALS, distanceMeters: 20, pointInParcel: false }, 150);
    const farNotContained = scoreCandidate({ ...NULL_SIGNALS, distanceMeters: 140, pointInParcel: false }, 150);
    expect(contained.evidence.spatialEvidenceStrong).toBe(true);
    expect(tightDistanceNotContained.evidence.spatialEvidenceStrong).toBe(true);
    expect(farNotContained.evidence.spatialEvidenceStrong).toBe(false);
  });
});
