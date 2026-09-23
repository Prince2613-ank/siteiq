export type Role = 'ADMIN' | 'ANALYST' | 'VIEWER';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  organizationId: string;
}

export interface UserRecord {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type IdentityStatus = 'IDENTIFYING' | 'NEEDS_REVIEW' | 'CONFIRMED' | 'MANUAL' | 'NO_MATCH';
export type InvestigationStatus = 'NEW' | 'IN_PROGRESS' | 'NEEDS_REVIEW' | 'COMPLETED' | 'ARCHIVED';

export interface Site {
  id: string;
  name: string | null;
  streetAddress: string | null;
  city: string | null;
  state: string;
  zip: string | null;
  municipality: string | null;
  originalInputAddress: string | null;
  parcelRef: string | null;
  identityStatus: IdentityStatus;
  confirmedCandidateId: string | null;
  matchConfidence: number | null;
  matchMethod: string | null;
  latitude: number | null;
  longitude: number | null;
  investigationStatus: InvestigationStatus;
  assignedAnalystId: string | null;
  assignedAnalyst: { id: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
}

export type FieldStatus =
  | 'MATCHED'
  | 'PARTIAL'
  | 'NO_MATCH'
  | 'SOURCE_UNAVAILABLE'
  | 'FIELD_UNAVAILABLE'
  | 'CONFLICTING'
  | 'NEEDS_REVIEW';

export interface SiteDataFieldObservation {
  id: string;
  fieldName: string;
  fieldType: 'NUMBER' | 'STRING' | 'BOOLEAN' | 'DATE' | 'GEO';
  value: unknown;
  numericValue: number | null;
  sourceName: string;
  sourceUrl: string | null;
  retrievedAt: string;
  status: FieldStatus;
  confidence: number | null;
  isCurrent: boolean;
  createdAt: string;
}

export interface SiteFieldGroup {
  fieldName: string;
  current: SiteDataFieldObservation | null;
  observations: SiteDataFieldObservation[];
}

export interface Note {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; email: string };
}

export interface ActivityEvent {
  id: string;
  eventType: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; email: string } | null;
}
