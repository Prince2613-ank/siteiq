/** Simple bigram Dice-coefficient similarity — used only as a secondary,
 * local signal when a candidate came from the spatial search path (so it
 * didn't already carry a pg_trgm similarity score from the database).
 * Not used for the primary fuzzy-match query itself (that's pg_trgm,
 * parcel-mirror.repository.ts) — this just avoids a second DB round trip
 * to enrich spatial-path evidence. */
export function bigramSimilarity(a: string, b: string): number {
  const bigrams = (s: string) => {
    const clean = s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const set: string[] = [];
    for (let i = 0; i < clean.length - 1; i++) set.push(clean.slice(i, i + 2));
    return set;
  };
  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);
  if (aBigrams.length === 0 || bBigrams.length === 0) return 0;

  const bCounts = new Map<string, number>();
  for (const bg of bBigrams) bCounts.set(bg, (bCounts.get(bg) ?? 0) + 1);

  let matches = 0;
  for (const bg of aBigrams) {
    const count = bCounts.get(bg) ?? 0;
    if (count > 0) {
      matches++;
      bCounts.set(bg, count - 1);
    }
  }
  return (2 * matches) / (aBigrams.length + bBigrams.length);
}
