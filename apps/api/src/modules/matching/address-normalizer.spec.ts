import { houseNumbersMatch, normalizeAddress } from './address-normalizer';

describe('normalizeAddress', () => {
  it('parses a full address into components', () => {
    const r = normalizeAddress('142 Elm Street, Worcester, MA 01609');
    expect(r.houseNumber).toBe('142');
    expect(r.streetLine).toBe('142 elm st');
    expect(r.city).toBe('Worcester');
    expect(r.state).toBe('MA');
    expect(r.zip).toBe('01609');
  });

  it('handles a bare street line with no city/state/zip', () => {
    const r = normalizeAddress('142 Elm St');
    expect(r.streetLine).toBe('142 elm st');
    expect(r.city).toBeNull();
  });

  it('handles an incomplete address with no house number', () => {
    const r = normalizeAddress('Elm St, Worcester, MA');
    expect(r.houseNumber).toBeNull();
    expect(r.streetLine).toBe('elm st');
    expect(r.city).toBe('Worcester');
  });

  it('never throws on garbled input', () => {
    expect(() => normalizeAddress('')).not.toThrow();
    expect(() => normalizeAddress(',,,')).not.toThrow();
    expect(() => normalizeAddress('xyzzy')).not.toThrow();
  });

  it('normalizes common street-suffix abbreviations consistently', () => {
    expect(normalizeAddress('1 Main Street').streetLine).toBe('1 main st');
    expect(normalizeAddress('1 Main St').streetLine).toBe('1 main st');
    expect(normalizeAddress('1 Main Str').streetLine).toBe('1 main st');
  });

  // --- Round 4: real hyphenated-range / combined-number patterns found in
  // the actual MassGIS mirror data (Sterling, Milton) ---

  it('parses a hyphenated house-number range (real Sterling data: "7-9 Chocksett Road")', () => {
    const r = normalizeAddress('7-9 Chocksett Road');
    expect(r.houseNumberRange).toEqual([7, 9]);
    expect(r.streetName).toBe('chocksett rd');
  });

  it('parses a combined-parcel double house number (real Milton data: "410 412 Granite Ave")', () => {
    const r = normalizeAddress('410 412 Granite Ave');
    expect(r.houseNumber).toBe('410');
    expect(r.houseNumber2).toBe('412');
    expect(r.streetName).toBe('granite ave');
  });
});

describe('houseNumbersMatch', () => {
  it('matches an exact single number', () => {
    expect(houseNumbersMatch(normalizeAddress('73 Granite Ave'), normalizeAddress('73 Granite Ave'))).toBe(true);
  });

  it('does not match a different single number', () => {
    expect(houseNumbersMatch(normalizeAddress('73 Granite Ave'), normalizeAddress('84 Granite Ave'))).toBe(false);
  });

  it('matches a clue number that falls within a candidate hyphenated range', () => {
    const clue = normalizeAddress('8 Chocksett Road');
    const candidate = normalizeAddress('7-9 Chocksett Road');
    expect(houseNumbersMatch(clue, candidate)).toBe(true);
  });

  it('does not match a clue number outside a candidate hyphenated range', () => {
    const clue = normalizeAddress('11 Chocksett Road');
    const candidate = normalizeAddress('7-9 Chocksett Road');
    expect(houseNumbersMatch(clue, candidate)).toBe(false);
  });

  it('matches either number on a combined-parcel double listing', () => {
    const candidate = normalizeAddress('410 412 Granite Ave');
    expect(houseNumbersMatch(normalizeAddress('410 Granite Ave'), candidate)).toBe(true);
    expect(houseNumbersMatch(normalizeAddress('412 Granite Ave'), candidate)).toBe(true);
    expect(houseNumbersMatch(normalizeAddress('414 Granite Ave'), candidate)).toBe(false);
  });

  it('returns null (not false) when either side has no house number to compare', () => {
    expect(houseNumbersMatch(normalizeAddress('Granite Ave'), normalizeAddress('73 Granite Ave'))).toBeNull();
    expect(houseNumbersMatch(normalizeAddress('73 Granite Ave'), normalizeAddress('Granite Ave'))).toBeNull();
  });
});
