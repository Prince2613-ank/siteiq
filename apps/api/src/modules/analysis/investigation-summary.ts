/**
 * The structured investigation-summary shape (Checkpoint 9). Deliberately
 * NOT a single opaque score — the client's explicit instruction was
 * "transparent," a checklist an analyst can act on, not a number they have
 * to trust blindly. Every section here traces back to real data (Site,
 * SiteDataField, Document) computed fresh at analysis-run time — nothing
 * here is invented if the underlying data doesn't support it.
 */

export const REQUIRED_PROPERTY_FIELDS = ['lot_size', 'zoning_code'] as const;
export const REQUIRED_DOCUMENT_CATEGORIES = ['Site Plan', 'Survey'] as const;
/** A field observation older than this is flagged as stale in dataQuality —
 * a first-guess threshold (docs/06's freshness bands used 180 days for the
 * "amber" cutoff; reused here for consistency), not a hard business rule. */
export const STALE_SOURCE_DAYS = 180;

export const FIELD_LABELS: Record<string, string> = {
  lot_size: 'Lot size',
  zoning_code: 'Zoning',
  use_code: 'Use code',
};

export interface InvestigationSummary {
  generatedAt: string;
  identity: {
    status: string;
    parcelRef: string | null;
    confidence: number | null;
    method: string | null;
    confirmedAt: string | null;
    confirmedBy: string | null;
  };
  propertyData: {
    fieldName: string;
    label: string;
    status: 'confirmed' | 'unavailable' | 'conflicting' | 'needs_review';
    value: unknown;
    source: string | null;
    retrievedAt: string | null;
  }[];
  dataQuality: {
    missingFields: string[];
    conflictingFields: string[];
    sourcesUsed: string[];
    staleSources: { field: string; source: string; ageDays: number }[];
  };
  documents: {
    required: string[];
    uploaded: { category: string; filename: string; uploadedAt: string }[];
    missing: string[];
  };
  investigation: {
    complete: boolean;
    requiredActions: string[];
  };
}
