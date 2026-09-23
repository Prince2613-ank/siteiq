import { InvestigationSummary } from '../analysis/investigation-summary';

/**
 * Checkpoint 10 — the immutable report shape. Once written to
 * `Report.contentSnapshot`, this object is NEVER updated by any code path
 * in the app — no `reportsService.update()` exists at all, which is what
 * makes the immutability guarantee structural rather than a promise
 * (docs/01 §4.3, docs/03 §2.3). Every later reader gets exactly what was
 * true at `generatedAt`, even if the live Site/SiteDataField/Document rows
 * change afterward.
 */
export interface ReportSnapshot {
  snapshotVersion: 1;
  generatedAt: string;
  generatedBy: string; // email
  /** True if Site.identityStatus was not CONFIRMED at generation time —
   * permanent, like AnalysisRun.isPreliminary (Checkpoint 5/7/9's rule). */
  isPreliminary: boolean;

  identity: {
    originalInputType: string;
    originalInputAddress: string | null;
    originalInputParcelRef: string | null;
    matchedAddress: string | null; // from the confirmed candidate, if any
    parcelRef: string | null;
    identityStatus: string;
    matchConfidence: number | null;
    matchMethod: string | null;
    confirmedBy: string | null;
    confirmedAt: string | null;
  };

  propertyData: InvestigationSummary['propertyData'];
  investigationQuality: InvestigationSummary['dataQuality'];

  documents: {
    filename: string;
    category: string;
    uploadedBy: string;
    uploadedAt: string;
  }[];

  analysis: {
    complete: boolean;
    requiredActions: string[];
    /** The AnalysisRun this report is based on, if one exists — its own
     * timestamp/preliminary flag, distinct from the report's own
     * generatedAt/isPreliminary above (a report can be generated without
     * ever running a formal AnalysisRun; this is null in that case). */
    basedOnRun: { id: string; completedAt: string | null; isPreliminary: boolean; status: string } | null;
  };

  auditTrail: {
    eventType: string;
    actor: string | null;
    createdAt: string;
  }[];
}

/** Which ActivityEvent types are meaningful enough to include in a report
 * (client's list: parcel confirmation, re-match conflicts, field
 * approvals, document additions — plus a few adjacent ones for
 * completeness). Login events, routine status pings, etc. are deliberately
 * excluded — a report is a curated record, not a raw log dump. */
export const REPORT_AUDIT_EVENT_TYPES = [
  'site_created',
  'parcel_confirmed',
  'rematch_conflict_detected',
  'duplicate_decision_recorded',
  'field_conflict_detected',
  'field_conflict_resolved',
  'document_uploaded',
  'document_deleted',
  'assignment_changed',
  'status_changed',
];
