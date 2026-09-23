import { extractLocationClues } from './location-clues';

describe('extractLocationClues', () => {
  it('parses the real client example deterministically', () => {
    const clues = extractLocationClues('0.25 mi S of Methuen-Lawrence TL on Marston St');
    expect(clues.streetHint).toBe('Marston St');
    expect(clues.distanceMiles).toBe(0.25);
    expect(clues.direction).toBe('S');
    expect(clues.landmark).toBe('Methuen-Lawrence TL');
  });

  it('handles a two-letter compound direction', () => {
    const clues = extractLocationClues('1.5 mi NE of Town Hall on Main St');
    expect(clues.direction).toBe('NE');
    expect(clues.distanceMiles).toBe(1.5);
  });

  it('returns nulls for empty/missing input rather than throwing', () => {
    expect(extractLocationClues(null)).toEqual({
      streetHint: null,
      distanceMiles: null,
      direction: null,
      landmark: null,
    });
    expect(extractLocationClues('')).toEqual({
      streetHint: null,
      distanceMiles: null,
      direction: null,
      landmark: null,
    });
  });

  it('extracts just a street hint from a bare "on <street>" fragment with no distance/landmark', () => {
    const clues = extractLocationClues('Near the depot entrance on Sunderland Rd');
    expect(clues.streetHint).toBe('Sunderland Rd');
    expect(clues.distanceMiles).toBeNull();
  });

  it('does not fabricate a street hint when there is no "on <street>" fragment', () => {
    const clues = extractLocationClues('Behind the old mill building');
    expect(clues.streetHint).toBeNull();
  });
});
