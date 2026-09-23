import { apiRequest, apiUpload, API_BASE } from './client';

export interface DocumentRecord {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  uploadedAt: string;
  uploadedBy: { id: string; email: string };
}

export const documentsApi = {
  list: (siteId: string) => apiRequest<DocumentRecord[]>(`/sites/${siteId}/documents`),
  upload: (siteId: string, file: File, category: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('category', category);
    return apiUpload<DocumentRecord>(`/sites/${siteId}/documents`, form);
  },
  remove: (documentId: string) => apiRequest(`/documents/${documentId}`, { method: 'DELETE' }),
  downloadUrl: (documentId: string) => `${API_BASE}/documents/${documentId}/download`,
};
