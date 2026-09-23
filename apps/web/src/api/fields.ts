import { apiRequest } from './client';
import type { SiteFieldGroup } from './types';

export const fieldsApi = {
  list: (siteId: string) => apiRequest<SiteFieldGroup[]>(`/sites/${siteId}/fields`),
  approve: (siteId: string, fieldId: string, note?: string) =>
    apiRequest(`/sites/${siteId}/fields/${fieldId}/approve`, { method: 'POST', body: { note } }),
};
