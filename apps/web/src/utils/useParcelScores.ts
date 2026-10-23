import { useMemo } from 'react';
import { scoreParcel, scoringStorageKey, withNearbyIndustry, type ScoringInput } from './parcelScoring';

export type RankedParcel = ScoringInput & { town?: string; parcel_id?: string; address?: string };
export type ParcelScore = ReturnType<typeof scoreParcel>;

export function useParcelScores(parcels: { properties: RankedParcel; geometry?: { type: string; coordinates: unknown } | null }[]) {
  // Only source records determine the score. Previous browser overrides are ignored.
  const scores = useMemo(() => new Map(withNearbyIndustry(parcels).map(properties =>
    [scoringStorageKey(properties), scoreParcel(properties)])), [parcels]);
  return { scores };
}
