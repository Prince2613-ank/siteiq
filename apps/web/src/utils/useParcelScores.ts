import { useMemo } from 'react';
import { scoreParcel, scoringStorageKey, type ScoringInput } from './parcelScoring';

export type RankedParcel = ScoringInput & { town?: string; parcel_id?: string; address?: string };
export type ParcelScore = ReturnType<typeof scoreParcel>;

export function useParcelScores(parcels: { properties: RankedParcel }[]) {
  // Only source records determine the score. Previous browser overrides are ignored.
  const scores = useMemo(() => new Map(parcels.map(({ properties }) =>
    [scoringStorageKey(properties), scoreParcel(properties)])), [parcels]);
  return { scores };
}
