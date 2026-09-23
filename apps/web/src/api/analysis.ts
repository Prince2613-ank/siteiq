import { apiRequest } from './client';

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
  investigation: { complete: boolean; requiredActions: string[] };
}

export interface AnalysisRun {
  id: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  isPreliminary: boolean;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result: InvestigationSummary | null;
  triggeredBy: { id: string; email: string };
}

export const analysisApi = {
  list: (siteId: string) => apiRequest<AnalysisRun[]>(`/sites/${siteId}/analysis-runs`),
  create: (siteId: string) => apiRequest<AnalysisRun>(`/sites/${siteId}/analysis-runs`, { method: 'POST' }),
  get: (runId: string) => apiRequest<AnalysisRun>(`/analysis-runs/${runId}`),
  retry: (runId: string) => apiRequest<AnalysisRun>(`/analysis-runs/${runId}/retry`, { method: 'POST' }),
};
