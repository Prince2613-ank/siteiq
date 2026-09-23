import { apiRequest } from './client';
import type { InvestigationSummary } from './analysis';

export interface ReportSnapshot {
  snapshotVersion: number;
  generatedAt: string;
  generatedBy: string;
  isPreliminary: boolean;
  identity: {
    originalInputType: string;
    originalInputAddress: string | null;
    originalInputParcelRef: string | null;
    matchedAddress: string | null;
    parcelRef: string | null;
    identityStatus: string;
    matchConfidence: number | null;
    matchMethod: string | null;
    confirmedBy: string | null;
    confirmedAt: string | null;
  };
  propertyData: InvestigationSummary['propertyData'];
  investigationQuality: InvestigationSummary['dataQuality'];
  documents: { filename: string; category: string; uploadedBy: string; uploadedAt: string }[];
  analysis: {
    complete: boolean;
    requiredActions: string[];
    basedOnRun: { id: string; completedAt: string | null; isPreliminary: boolean; status: string } | null;
  };
  auditTrail: { eventType: string; actor: string | null; createdAt: string }[];
}

export interface ReportRecord {
  id: string;
  generatedAt: string;
  snapshotVersion: number;
  contentSnapshot: ReportSnapshot;
  generatedBy: { id: string; email: string };
}

export const reportsApi = {
  list: (siteId: string) => apiRequest<ReportRecord[]>(`/sites/${siteId}/reports`),
  generate: (siteId: string) => apiRequest<ReportRecord>(`/sites/${siteId}/reports`, { method: 'POST' }),
  get: (reportId: string) => apiRequest<ReportRecord>(`/reports/${reportId}`),
};
