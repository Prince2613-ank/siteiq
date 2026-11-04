import { useMemo } from 'react';
import { scoreParcel, scoringStorageKey, withNearbyIndustry, type ScoringInput } from './parcelScoring';

export type RankedParcel = ScoringInput & { town?: string; parcel_id?: string; address?: string; keep?: string };
export type ParcelScore = ReturnType<typeof scoreParcel>;

export function computeParcelRanks(
  parcels: { properties: RankedParcel; geometry?: { type: string; coordinates: unknown } | null }[],
  scoresMap?: Map<string, ParcelScore>
) {
  const scores = scoresMap ?? new Map(withNearbyIndustry(parcels).map(properties =>
    [scoringStorageKey(properties), scoreParcel(properties)]));

  const rankedParcels = [...parcels].sort((a, b) => {
    const pa = a.properties;
    const pb = b.properties;
    const qualificationDifference = (pb.keep === 'Y' ? 1 : 0) - (pa.keep === 'Y' ? 1 : 0);
    if (qualificationDifference) return qualificationDifference;
    const scoreDifference = (scores.get(scoringStorageKey(pb))?.score ?? 0) - (scores.get(scoringStorageKey(pa))?.score ?? 0);
    if (scoreDifference) return scoreDifference;
    const addressDifference = (pa.address || pa.parcel_id || '').localeCompare(pb.address || pb.parcel_id || '', 'en', { numeric: true, sensitivity: 'base' });
    return addressDifference || scoringStorageKey(pa).localeCompare(scoringStorageKey(pb), 'en');
  });

  const ranks = new Map(rankedParcels.map((feature, index) =>
    [scoringStorageKey(feature.properties), feature.properties.keep === 'Y' ? index + 1 : 0]));

  return { scores, ranks, rankedParcels };
}

export function useParcelScores(parcels: { properties: RankedParcel; geometry?: { type: string; coordinates: unknown } | null }[]) {
  // Only source records determine the score. Previous browser overrides are ignored.
  return useMemo(() => computeParcelRanks(parcels), [parcels]);
}
