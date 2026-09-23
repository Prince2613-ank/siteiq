import { apiRequest } from './client';
import type { ActivityEvent, AuthUser, Note, Site, UserRecord } from './types';

export const authApi = {
  login: (email: string, password: string) =>
    apiRequest<{ accessToken: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: { email, password },
      skipAuthRetry: true,
    }),
  refresh: () =>
    apiRequest<{ accessToken: string; user: AuthUser }>('/auth/refresh', {
      method: 'POST',
      skipAuthRetry: true,
    }),
  logout: () => apiRequest('/auth/logout', { method: 'POST' }),
  me: () => apiRequest<AuthUser>('/auth/me'),
};

export const usersApi = {
  list: () => apiRequest<UserRecord[]>('/users'),
  invite: (email: string, role: string) =>
    apiRequest<{ id: string; email: string; role: string; temporaryPassword: string }>(
      '/users/invite',
      { method: 'POST', body: { email, role } },
    ),
  update: (id: string, body: { role?: string; isActive?: boolean }) =>
    apiRequest<UserRecord>(`/users/${id}`, { method: 'PATCH', body }),
};

export interface SiteListParams {
  search?: string;
  investigationStatus?: string;
  municipality?: string;
  assignedAnalystId?: string;
}

export const sitesApi = {
  list: (params: SiteListParams = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v) as [string, string][],
    ).toString();
    return apiRequest<{ items: Site[]; nextCursor: string | null }>(
      `/sites${qs ? `?${qs}` : ''}`,
    );
  },
  get: (id: string) => apiRequest<Site>(`/sites/${id}`),
  getGeometry: (id: string) =>
    apiRequest<{ boundary: { type: string; coordinates: unknown } | null; centroid: { type: string; coordinates: unknown } | null }>(
      `/sites/${id}/geometry`,
    ),
  create: (body: {
    name?: string;
    streetAddress?: string;
    city: string;
    state: string;
    zip?: string;
    parcelRef?: string;
    lat?: number;
    lng?: number;
    locationText?: string;
    locationDescription?: string;
    facilityId?: string;
    assignedAnalystId?: string;
  }) => apiRequest<Site>('/sites', { method: 'POST', body }),
  update: (
    id: string,
    body: { name?: string; assignedAnalystId?: string | null; investigationStatus?: string },
  ) => apiRequest<Site>(`/sites/${id}`, { method: 'PATCH', body }),
  archive: (id: string) => apiRequest(`/sites/${id}`, { method: 'DELETE' }),
};

export const notesApi = {
  list: (siteId: string) => apiRequest<Note[]>(`/sites/${siteId}/notes`),
  create: (siteId: string, body: string) =>
    apiRequest<Note>(`/sites/${siteId}/notes`, { method: 'POST', body: { body } }),
};

export const activityApi = {
  list: (siteId: string) => apiRequest<ActivityEvent[]>(`/sites/${siteId}/activity`),
};
