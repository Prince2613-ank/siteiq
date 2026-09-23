import { apiRequest } from './client';

export interface MatchAttempt {
  id: string;
  siteId: string;
  strategyUsed: 'EXACT' | 'FUZZY' | 'SPATIAL' | 'PARCEL_ID';
  candidateCount: number;
  topConfidence: number | null;
  createdAt: string;
}

export interface CandidateEvidence {
  addressSimilarity: number | null;
  distanceMeters: number | null;
  distanceScore: number | null;
  parcelIdMatch: boolean | null;
  municipalityMatch: boolean | null;
  pointInParcel: boolean | null;
  locationTextSimilarity: number | null;
  houseNumberMatch: boolean | null;
  streetSuffixMatch: boolean | null;
  lowCorroboration: boolean;
  conflictDetected: boolean;
  conflictingCandidateParcelRef: string | null;
  spatialEvidenceStrong: boolean;
  addressEvidenceConflict: boolean;
  manualVerificationRequired: boolean;
  /** Round 4: cross-search conflict — address-family search and spatial
   * search identified different parcels. Alias of conflictDetected. */
  identityEvidenceConflict: boolean;
  addressEvidenceStrength: 'strong' | 'medium' | 'weak' | 'none';
  spatialEvidenceStrength: 'strong' | 'medium' | 'weak' | 'none';
  /** Which independent search(es) found this candidate. Null for
   * EXACT/FUZZY/PARCEL_ID strategies (single-method searches). */
  agreement: 'AGREE' | 'CONFLICT' | 'ADDRESS_ONLY' | 'SPATIAL_ONLY' | null;
  /** Which search stage surfaced this candidate (150m default, or the 500m
   * expanded search) — null for a candidate found only by the address
   * search, which isn't radius-based at all. */
  searchRadiusMeters: number | null;
  sourceName: string;
  sourceUrl: string | null;
  retrievedAt: string;
  sourceAgeDays: number;
}

export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

export interface MatchCandidate {
  id: string;
  attemptId: string;
  parcelRef: string;
  matchedAddress: string;
  municipality: string;
  confidence: number;
  evidence: CandidateEvidence;
  rank: number;
  status: 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED';
  note: string | null;
  duplicateOfSiteId: string | null;
  duplicateOfSite: { id: string; name: string | null; streetAddress: string; city: string } | null;
  geometry: { boundary: GeoJsonGeometry; centroid: GeoJsonGeometry } | null;
}

export const matchingApi = {
  listAttempts: (siteId: string) =>
    apiRequest<MatchAttempt[]>(`/sites/${siteId}/match-attempts`),
  listCandidates: (siteId: string, attemptId: string) =>
    apiRequest<MatchCandidate[]>(`/sites/${siteId}/match-attempts/${attemptId}/candidates`),
  confirm: (
    siteId: string,
    attemptId: string,
    candidateId: string,
    body: { note?: string; duplicateDecision?: 'NONE' | 'OPENED_EXISTING' | 'CONTINUED_SEPARATE' },
  ) =>
    apiRequest<{ confirmedCandidate: MatchCandidate; site: unknown }>(
      `/sites/${siteId}/match-attempts/${attemptId}/candidates/${candidateId}/confirm`,
      { method: 'POST', body },
    ),
  rejectAll: (siteId: string, attemptId: string) =>
    apiRequest(`/sites/${siteId}/match-attempts/${attemptId}/reject-all`, { method: 'POST' }),
  reMatch: (siteId: string, body: { address?: string; parcelRef?: string; lat?: number; lng?: number }) =>
    apiRequest(`/sites/${siteId}/re-match`, { method: 'POST', body }),
};
