import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { sitesApi, notesApi, activityApi, usersApi } from '../api/endpoints';
import { matchingApi } from '../api/matching';
import { fieldsApi } from '../api/fields';
import { documentsApi } from '../api/documents';
import { analysisApi } from '../api/analysis';
import { reportsApi } from '../api/reports';
import { ApiError, getAccessToken } from '../api/client';
import type { Site, SiteDataFieldObservation } from '../api/types';
import { Badge } from '../components/Badge';
import { ParcelMap } from '../components/ParcelMap';
import { useAuth } from '../context/AuthContext';

const TABS = [
  'Overview',
  'Property / Parcel',
  'Zoning',
  'Map',
  'Documents',
  'Analysis',
  'Reports',
  'Notes',
  'Activity / History',
] as const;
type Tab = (typeof TABS)[number];

export function SiteDetails() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('Overview');
  const queryClient = useQueryClient();

  const { data: site, isLoading } = useQuery({
    queryKey: ['sites', id],
    queryFn: () => sitesApi.get(id!),
    enabled: !!id,
  });
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });

  const assignMutation = useMutation({
    mutationFn: (assignedAnalystId: string) =>
      sitesApi.update(id!, { assignedAnalystId: assignedAnalystId || null }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sites', id] }),
  });

  const reMatchMutation = useMutation({
    mutationFn: (address: string) => matchingApi.reMatch(id!, { address }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites', id] });
      navigate(`/sites/${id}/candidates`);
    },
  });

  function handleReMatch() {
    const address = window.prompt(
      'Enter the corrected/updated address to re-run automated matching with:',
      site?.originalInputAddress ?? '',
    );
    if (address && address.trim()) reMatchMutation.mutate(address.trim());
  }

  const canEdit = user?.role === 'ADMIN' || user?.role === 'ANALYST';

  if (isLoading || !site) return <div className="p-8 text-sm text-slate-400">Loading…</div>;

  // A re-match that ran AFTER a confirmation flips identityStatus back to
  // NEEDS_REVIEW without clearing the previously confirmed parcel — so
  // "confirmedCandidateId still set, but status needs review again" IS the
  // re-match-conflict state the client asked to see distinctly (docs/02
  // §2.3, Checkpoint 7 requirement).
  const isReMatchConflict = site.identityStatus === 'NEEDS_REVIEW' && !!site.confirmedCandidateId;

  return (
    <div>
      <div className="bg-white border-b border-slate-200 px-6 pt-3">
        <div className="text-[11px] text-slate-400 mb-1">Sites › {site.municipality}</div>
        <div className="flex items-center justify-between pb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">{site.name || site.streetAddress}</span>
            <span className="text-xs text-slate-400">
              {site.streetAddress}, {site.city}, {site.state} {site.zip}
            </span>
            <Badge value={site.identityStatus} />
            <Badge value={site.investigationStatus} />
          </div>
          <div className="flex items-center gap-2 text-xs">
            {canEdit && site.identityStatus === 'CONFIRMED' && (
              <button onClick={handleReMatch} disabled={reMatchMutation.isPending} className="btn">
                {reMatchMutation.isPending ? 'Re-matching…' : 'Re-run Matching'}
              </button>
            )}
            <span className="text-slate-500">Assigned:</span>
            <select
              disabled={!canEdit}
              value={site.assignedAnalystId ?? ''}
              onChange={(e) => assignMutation.mutate(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1"
            >
              <option value="">Unassigned</option>
              {users?.filter((u) => u.role !== 'VIEWER' && u.isActive).map((u) => (
                <option key={u.id} value={u.id}>{u.email}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="text-[11px] text-slate-400 pb-3">
          Original input: <span className="text-slate-600">"{site.originalInputAddress}"</span>
          {' · '}Assignment is informational only — any analyst can view/edit this site.
        </div>

        {isReMatchConflict ? (
          <div className="mb-3 bg-red-50 border border-red-300 rounded px-3 py-2 text-xs text-red-900 flex items-center justify-between">
            <span>
              ⚠ A re-match produced different results than the parcel already confirmed for this
              site (<strong>{site.parcelRef}</strong>). The confirmed parcel has <strong>not</strong> been
              changed — review the new candidates and decide explicitly.
            </span>
            <Link to={`/sites/${site.id}/candidates`} className="font-semibold underline whitespace-nowrap ml-3">
              Review new candidates →
            </Link>
          </div>
        ) : (
          (site.identityStatus === 'IDENTIFYING' || site.identityStatus === 'NEEDS_REVIEW' || site.identityStatus === 'NO_MATCH') && (
            <div className="mb-3 bg-amber-50 border border-amber-300 rounded px-3 py-2 text-xs text-amber-900 flex items-center justify-between">
              <span>
                {site.identityStatus === 'IDENTIFYING' && 'SiteIQ is still investigating this property.'}
                {site.identityStatus === 'NEEDS_REVIEW' && 'Parcel candidates are ready for your review.'}
                {site.identityStatus === 'NO_MATCH' && 'No reliable parcel match was found automatically.'}
              </span>
              <Link to={`/sites/${site.id}/candidates`} className="font-semibold underline">
                {site.identityStatus === 'IDENTIFYING' ? 'View status' : 'Review candidates'} →
              </Link>
            </div>
          )
        )}

        <div className="flex gap-5 border-t border-slate-100 -mx-6 px-6 pt-2">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-xs pb-2 border-b-2 ${
                tab === t ? 'border-slate-800 font-semibold text-slate-800' : 'border-transparent text-slate-400'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 max-w-4xl">
        {tab === 'Overview' && <OverviewTab site={site} />}
        {tab === 'Property / Parcel' && <FieldsTab site={site} fieldNames={['lot_size', 'use_code']} />}
        {tab === 'Zoning' && <FieldsTab site={site} fieldNames={['zoning_code']} />}
        {tab === 'Map' && <MapTab site={site} />}
        {tab === 'Documents' && <DocumentsTab siteId={site.id} canEdit={canEdit} />}
        {tab === 'Analysis' && <AnalysisTab site={site} canEdit={canEdit} />}
        {tab === 'Reports' && <ReportsTab siteId={site.id} canEdit={canEdit} />}
        {tab === 'Notes' && <NotesTab siteId={site.id} canEdit={canEdit} />}
        {tab === 'Activity / History' && <ActivityTab siteId={site.id} />}
      </div>
    </div>
  );
}

function OverviewTab({ site }: { site: Site }) {
  return (
    <div className="bg-white border border-slate-200 rounded p-5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-3">
        Site record
      </div>
      <Row label="Municipality" value={site.municipality} />
      <Row label="Parcel reference" value={site.parcelRef ?? 'Not yet identified'} />
      <Row label="Identity status" value={<Badge value={site.identityStatus} />} />
      {site.identityStatus === 'CONFIRMED' && (
        <Row
          label="Match confidence"
          value={`${site.matchConfidence}% · ${site.matchMethod} match`}
        />
      )}
      <Row label="Investigation status" value={<Badge value={site.investigationStatus} />} />
      <Row label="Created" value={new Date(site.createdAt).toLocaleString()} />
      <Row label="Last updated" value={new Date(site.updatedAt).toLocaleString()} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center py-2 border-b border-slate-50 text-sm">
      <div className="w-44 text-slate-500 font-medium">{label}</div>
      <div className="flex-1">{value}</div>
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  lot_size: 'Lot size',
  use_code: 'Use code',
  zoning_code: 'Zoning',
};

/**
 * Renders real SiteDataField provenance (Checkpoint 7) — value, source,
 * retrieved date, and status, per the client's explicit format request. A
 * field with no MassGIS value shows "Unavailable from MassGIS", never a
 * guess.
 */
function FieldsTab({ site, fieldNames }: { site: Site; fieldNames: string[] }) {
  const { data: groups, isLoading } = useQuery({
    queryKey: ['fields', site.id],
    queryFn: () => fieldsApi.list(site.id),
    enabled: site.identityStatus === 'CONFIRMED',
  });

  if (site.identityStatus !== 'CONFIRMED') {
    return (
      <div className="bg-white border border-dashed border-slate-300 rounded p-6 text-sm text-slate-500">
        The parcel identity for this site hasn't been confirmed yet — review the candidates first.
      </div>
    );
  }
  if (isLoading) return <div className="text-sm text-slate-400">Loading…</div>;

  return (
    <div className="bg-white border border-slate-200 rounded p-5 space-y-5">
      {fieldNames.map((fieldName) => {
        const group = groups?.find((g) => g.fieldName === fieldName);
        return (
          <FieldRow
            key={fieldName}
            siteId={site.id}
            fieldName={fieldName}
            current={group?.current ?? null}
            observations={group?.observations ?? []}
          />
        );
      })}
    </div>
  );
}

/**
 * Renders real SiteDataField provenance (Checkpoint 7/8) — value, source,
 * retrieved date, status. When a field is genuinely CONFLICTING (two
 * independent MassGIS sources disagree — Checkpoint 8), this is where the
 * client's Conflict Resolution requirement lives: both observations shown
 * side by side, analyst picks one, decision recorded via the real
 * SiteDataFieldApproval-backed approve endpoint — not fixture data.
 */
function FieldRow({
  siteId,
  fieldName,
  current,
  observations,
}: {
  siteId: string;
  fieldName: string;
  current: SiteDataFieldObservation | null;
  observations: SiteDataFieldObservation[];
}) {
  const label = FIELD_LABELS[fieldName] ?? fieldName;
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');

  const conflicting = observations.filter((o) => o.status === 'CONFLICTING');
  const isConflict = conflicting.length > 0 && !current;

  const approveMutation = useMutation({
    mutationFn: (fieldId: string) => fieldsApi.approve(siteId, fieldId, note || undefined),
    onSuccess: () => {
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['fields', siteId] });
      queryClient.invalidateQueries({ queryKey: ['sites', siteId] });
      queryClient.invalidateQueries({ queryKey: ['sites', 'activity', siteId] });
    },
  });

  if (isConflict) {
    return (
      <div className="border-b border-slate-50 pb-4 last:border-b-0 last:pb-0">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-2">
          {label} <Badge value="CONFLICTING" label="conflicting sources" />
        </div>
        <div className="space-y-2">
          {conflicting.map((obs) => (
            <div key={obs.id} className="border border-amber-300 bg-amber-50 rounded p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">{formatFieldValue(fieldName, obs.value, obs.numericValue)}</div>
                <button
                  onClick={() => approveMutation.mutate(obs.id)}
                  disabled={approveMutation.isPending}
                  className="text-xs bg-slate-800 text-white px-3 py-1 rounded font-semibold"
                >
                  Approve this value
                </button>
              </div>
              <div className="text-[11px] text-amber-900 mt-1">
                Source: {obs.sourceName} · Retrieved: {new Date(obs.retrievedAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note explaining your decision…"
          className="input mt-2"
        />
      </div>
    );
  }

  const unavailable = !current || current.status === 'FIELD_UNAVAILABLE';

  return (
    <div className="border-b border-slate-50 pb-4 last:border-b-0 last:pb-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      {unavailable ? (
        <div className="text-sm text-slate-400 flex items-center gap-2">
          <span className="italic">Unavailable from MassGIS</span>
          <Badge value="NO_MATCH" label="unavailable" />
        </div>
      ) : (
        <div>
          <div className="text-base font-semibold">
            {formatFieldValue(fieldName, current!.value, current!.numericValue)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Source: {current!.sourceName} · Retrieved: {new Date(current!.retrievedAt).toLocaleDateString()} ·{' '}
            <span className="text-green-700 font-semibold">Status: Confirmed</span>
          </div>
        </div>
      )}
    </div>
  );
}

function formatFieldValue(fieldName: string, value: unknown, numericValue: number | null): string {
  if (fieldName === 'lot_size' && numericValue !== null) {
    return `${numericValue.toLocaleString()} sq ft (${(numericValue / 43560).toFixed(2)} acres)`;
  }
  return String(value);
}

function MapTab({ site }: { site: Site }) {
  const { data: geometry, isLoading } = useQuery({
    queryKey: ['sites', site.id, 'geometry'],
    queryFn: () => sitesApi.getGeometry(site.id),
    enabled: site.identityStatus === 'CONFIRMED',
  });

  if (site.identityStatus !== 'CONFIRMED') {
    return (
      <div className="bg-white border border-dashed border-slate-300 rounded p-6 text-sm text-slate-500">
        The parcel identity for this site hasn't been confirmed yet — the map shows the real
        parcel boundary once a candidate is confirmed.
      </div>
    );
  }
  if (isLoading) return <div className="text-sm text-slate-400">Loading…</div>;

  return (
    <div className="bg-white border border-slate-200 rounded p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
        Confirmed parcel boundary — {site.parcelRef}
      </div>
      {geometry?.boundary ? (
        <ParcelMap
          height={420}
          confirmedGeometry={geometry.boundary && geometry.centroid ? { boundary: geometry.boundary, centroid: geometry.centroid } : null}
        />
      ) : (
        <div className="text-sm text-slate-400 italic">
          No boundary geometry available in the mirror for this parcel.
        </div>
      )}
      <div className="text-[10.5px] text-slate-400 mt-2">
        Real parcel boundary from the local PostGIS mirror (source: MassGIS). Nearby-sites overlay
        and measurement tools remain future work.
      </div>
    </div>
  );
}

function NotesTab({ siteId, canEdit }: { siteId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const { data: notes } = useQuery({ queryKey: ['notes', siteId], queryFn: () => notesApi.list(siteId) });
  const createMutation = useMutation({
    mutationFn: () => notesApi.create(siteId, body),
    onSuccess: () => {
      setBody('');
      queryClient.invalidateQueries({ queryKey: ['notes', siteId] });
      queryClient.invalidateQueries({ queryKey: ['sites', 'activity', siteId] });
    },
  });

  return (
    <div className="bg-white border border-slate-200 rounded p-5">
      {canEdit && (
        <div className="mb-5 flex gap-2">
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add an internal note…"
            className="input"
          />
          <button
            onClick={() => body.trim() && createMutation.mutate()}
            disabled={createMutation.isPending}
            className="btn-primary whitespace-nowrap"
          >
            Add Note
          </button>
        </div>
      )}
      <div className="space-y-3">
        {notes?.length === 0 && <div className="text-sm text-slate-400">No notes yet.</div>}
        {notes?.map((n) => (
          <div key={n.id} className="border-b border-slate-50 pb-3 text-sm">
            <div>{n.body}</div>
            <div className="text-[11px] text-slate-400 mt-1">
              {n.author.email} · {new Date(n.createdAt).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityTab({ siteId }: { siteId: string }) {
  const { data: events } = useQuery({
    queryKey: ['sites', 'activity', siteId],
    queryFn: () => activityApi.list(siteId),
  });

  return (
    <div className="bg-white border border-slate-200 rounded p-5">
      <div className="space-y-4">
        {events?.length === 0 && <div className="text-sm text-slate-400">No activity yet.</div>}
        {events?.map((e) => (
          <div key={e.id} className="flex gap-3 text-sm">
            <div
              className={`w-4 h-4 rounded-full border-2 mt-0.5 flex-shrink-0 ${
                e.eventType === 'rematch_conflict_detected'
                  ? 'border-red-600 bg-red-100'
                  : e.eventType === 'parcel_confirmed'
                    ? 'border-green-700 bg-green-100'
                    : 'border-slate-800'
              }`}
            />
            <div>
              <div className="font-semibold">{e.eventType.replace(/_/g, ' ')}</div>
              <div className="text-[11px] text-slate-400">
                {e.actor?.email ?? 'system'} · {new Date(e.createdAt).toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const DOCUMENT_CATEGORIES = ['Site Plan', 'Survey', 'Other'];

function DocumentsTab({ siteId, canEdit }: { siteId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState('Site Plan');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: documents, isLoading } = useQuery({
    queryKey: ['documents', siteId],
    queryFn: () => documentsApi.list(siteId),
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await documentsApi.upload(siteId, file, category);
      queryClient.invalidateQueries({ queryKey: ['documents', siteId] });
      queryClient.invalidateQueries({ queryKey: ['sites', 'activity', siteId] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDownload(documentId: string, filename: string) {
    const res = await fetch(documentsApi.downloadUrl(documentId), {
      credentials: 'include',
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const removeMutation = useMutation({
    mutationFn: (documentId: string) => documentsApi.remove(documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', siteId] });
      queryClient.invalidateQueries({ queryKey: ['sites', 'activity', siteId] });
    },
  });

  return (
    <div className="bg-white border border-slate-200 rounded p-5">
      {canEdit && (
        <div className="flex items-center gap-2 mb-5 pb-5 border-b border-slate-100">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="input" style={{ width: 160 }}>
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <label className="btn-primary cursor-pointer">
            {uploading ? 'Uploading…' : 'Choose File & Upload'}
            <input ref={fileInputRef} type="file" onChange={handleFileChange} disabled={uploading} className="hidden" />
          </label>
          <span className="text-[11px] text-slate-400">PDF, images, spreadsheets · up to 25MB</span>
        </div>
      )}
      {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">{error}</div>}

      {isLoading && <div className="text-sm text-slate-400">Loading…</div>}
      {!isLoading && documents?.length === 0 && <div className="text-sm text-slate-400">No documents uploaded yet.</div>}
      <table className="w-full text-sm">
        <tbody>
          {documents?.map((d) => (
            <tr key={d.id} className="border-b border-slate-50">
              <td className="py-2.5">
                <div className="font-semibold">{d.filename}</div>
                <div className="text-[11px] text-slate-400">
                  {d.category} · {(d.sizeBytes / 1024).toFixed(0)}KB · {d.uploadedBy.email} ·{' '}
                  {new Date(d.uploadedAt).toLocaleDateString()}
                </div>
              </td>
              <td className="py-2.5 text-right whitespace-nowrap">
                <button onClick={() => handleDownload(d.id, d.filename)} className="text-xs text-blue-700 mr-3">
                  Download
                </button>
                {canEdit && (
                  <button onClick={() => removeMutation.mutate(d.id)} className="text-xs text-red-600">
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnalysisTab({ site, canEdit }: { site: Site; canEdit: boolean }) {
  const queryClient = useQueryClient();

  const { data: runs } = useQuery({
    queryKey: ['analysis', site.id],
    queryFn: () => analysisApi.list(site.id),
    refetchInterval: (query) => {
      const latest = query.state.data?.[0];
      return latest && (latest.status === 'QUEUED' || latest.status === 'PROCESSING') ? 1200 : false;
    },
  });

  const createMutation = useMutation({
    mutationFn: () => analysisApi.create(site.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['analysis', site.id] }),
  });
  const retryMutation = useMutation({
    mutationFn: (runId: string) => analysisApi.retry(runId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['analysis', site.id] }),
  });

  const latest = runs?.[0];

  return (
    <div className="space-y-4">
      {canEdit && (
        <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="btn-primary">
          {createMutation.isPending ? 'Starting…' : 'Run Analysis'}
        </button>
      )}

      {!latest && <div className="text-sm text-slate-400">No analysis has been run for this site yet.</div>}

      {latest && (
        <div className="bg-white border border-slate-200 rounded p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-bold">Analysis run · {new Date(latest.createdAt).toLocaleString()}</div>
            <Badge value={latest.status === 'COMPLETED' ? 'CONFIRMED' : latest.status === 'FAILED' ? 'NO_MATCH' : 'IDENTIFYING'} label={latest.status} />
          </div>

          {latest.isPreliminary && (
            <div className="bg-amber-50 border border-amber-300 rounded px-3 py-2 text-xs text-amber-900 mb-4">
              ⚠ <strong>Preliminary</strong> — this run started before the parcel identity was confirmed. It stays
              preliminary permanently; run a new analysis after confirming for a final result.
            </div>
          )}

          {(latest.status === 'QUEUED' || latest.status === 'PROCESSING') && (
            <div className="text-sm text-slate-500">{latest.status === 'QUEUED' ? 'Queued…' : 'Processing…'}</div>
          )}

          {latest.status === 'FAILED' && (
            <div>
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">
                {latest.errorMessage}
              </div>
              {canEdit && (
                <button onClick={() => retryMutation.mutate(latest.id)} className="btn">Retry</button>
              )}
            </div>
          )}

          {latest.status === 'COMPLETED' && latest.result && <InvestigationChecklist summary={latest.result} />}
        </div>
      )}

      {runs && runs.length > 1 && (
        <div className="text-[11px] text-slate-400">{runs.length - 1} earlier run(s) also on record.</div>
      )}
    </div>
  );
}

function ck(ok: boolean) {
  return ok ? <span className="text-green-700">✓</span> : <span className="text-amber-600">⚠</span>;
}

/** Renders exactly the transparent checklist format the client specified —
 * deliberately not a single opaque score. */
function InvestigationChecklist({ summary }: { summary: import('../api/analysis').InvestigationSummary }) {
  const { identity, propertyData, dataQuality, documents, investigation } = summary;

  return (
    <div className="font-mono text-[12.5px] leading-relaxed space-y-4">
      <section>
        <div className="text-[11px] font-bold uppercase text-slate-500 mb-1">Property Identity</div>
        {identity.status === 'CONFIRMED' ? (
          <div>
            {ck(true)} Confirmed<br />
            &nbsp;&nbsp;Parcel: {identity.parcelRef}<br />
            &nbsp;&nbsp;Confidence: {identity.confidence}% ({identity.method})<br />
            &nbsp;&nbsp;Confirmed by: {identity.confirmedBy ?? '—'} {identity.confirmedAt && `on ${new Date(identity.confirmedAt).toLocaleDateString()}`}
          </div>
        ) : (
          <div>{ck(false)} {identity.status.replace(/_/g, ' ')}</div>
        )}
      </section>

      <section>
        <div className="text-[11px] font-bold uppercase text-slate-500 mb-1">Property Data</div>
        {propertyData.map((f) => (
          <div key={f.fieldName}>
            {ck(f.status === 'confirmed')} {f.label}:{' '}
            {f.status === 'confirmed' ? String(f.value) : f.status === 'conflicting' ? 'conflicting values' : 'unavailable'}
          </div>
        ))}
      </section>

      <section>
        <div className="text-[11px] font-bold uppercase text-slate-500 mb-1">Source Quality</div>
        {dataQuality.sourcesUsed.map((s) => <div key={s}>{ck(true)} {s} data available</div>)}
        {dataQuality.staleSources.map((s) => (
          <div key={s.field}>{ck(false)} {s.field} source is {s.ageDays} days old</div>
        ))}
        {dataQuality.sourcesUsed.length === 0 && <div>{ck(false)} No sources have provided data yet</div>}
      </section>

      <section>
        <div className="text-[11px] font-bold uppercase text-slate-500 mb-1">Conflicts</div>
        {dataQuality.conflictingFields.length === 0 ? (
          <div>{ck(true)} No unresolved conflicts</div>
        ) : (
          dataQuality.conflictingFields.map((f) => <div key={f}>{ck(false)} {f} — conflicting sources, needs review</div>)
        )}
      </section>

      <section>
        <div className="text-[11px] font-bold uppercase text-slate-500 mb-1">Documents</div>
        {documents.required.map((cat) => (
          <div key={cat}>{ck(!documents.missing.includes(cat))} {cat} {documents.missing.includes(cat) ? 'missing' : 'on file'}</div>
        ))}
      </section>

      <section>
        <div className="text-[11px] font-bold uppercase text-slate-500 mb-1">Investigation</div>
        <div className={investigation.complete ? 'text-green-700 font-bold' : 'text-amber-700 font-bold'}>
          {investigation.complete ? '✓ COMPLETE' : '⚠ INCOMPLETE'}
        </div>
        {investigation.requiredActions.length > 0 && (
          <div className="mt-2">
            <div className="text-[11px] font-bold uppercase text-slate-500 mb-1">Required actions</div>
            <ol className="list-decimal list-inside">
              {investigation.requiredActions.map((a, i) => <li key={i}>{a}</li>)}
            </ol>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Checkpoint 10 — reports are immutable snapshots. Selecting an older
 * report and viewing it always renders exactly the stored
 * `contentSnapshot`, never a re-join against today's live Site data —
 * that's the whole point (client's Sept 7 vs. Sept 10 example).
 */
function ReportsTab({ siteId, canEdit }: { siteId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: reports, isLoading } = useQuery({
    queryKey: ['reports', siteId],
    queryFn: () => reportsApi.list(siteId),
  });

  const generateMutation = useMutation({
    mutationFn: () => reportsApi.generate(siteId),
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: ['reports', siteId] });
      setSelectedId(report.id);
    },
  });

  const selected = reports?.find((r) => r.id === selectedId) ?? reports?.[0] ?? null;

  return (
    <div className="flex gap-4">
      <div className="w-64 flex-shrink-0 space-y-2">
        {canEdit && (
          <button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} className="btn-primary w-full">
            {generateMutation.isPending ? 'Generating…' : '+ Generate New Report'}
          </button>
        )}
        {isLoading && <div className="text-sm text-slate-400">Loading…</div>}
        {!isLoading && reports?.length === 0 && <div className="text-sm text-slate-400">No reports generated yet.</div>}
        {reports?.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelectedId(r.id)}
            className={`w-full text-left border rounded p-2.5 text-xs ${
              selected?.id === r.id ? 'border-slate-800 bg-slate-50' : 'border-slate-200'
            }`}
          >
            <div className="font-semibold">{new Date(r.generatedAt).toLocaleString()}</div>
            <div className="text-slate-400">by {r.generatedBy.email}</div>
            {r.contentSnapshot.isPreliminary && <Badge value="NEEDS_REVIEW" label="preliminary" />}
          </button>
        ))}
      </div>

      <div className="flex-1">
        {selected ? (
          <ReportSnapshotView snapshot={selected.contentSnapshot} generatedAt={selected.generatedAt} />
        ) : (
          <div className="bg-white border border-dashed border-slate-300 rounded p-6 text-sm text-slate-500">
            Generate a report to capture a permanent, point-in-time snapshot of this investigation —
            later changes to the site will never alter it.
          </div>
        )}
      </div>
    </div>
  );
}

function ReportSnapshotView({
  snapshot,
  generatedAt,
}: {
  snapshot: import('../api/reports').ReportSnapshot;
  generatedAt: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded p-6">
      <div className="flex items-center justify-between mb-1">
        <div className="text-base font-bold">Site Investigation Report</div>
        <div className="text-[11px] text-slate-400">Generated {new Date(generatedAt).toLocaleString()} by {snapshot.generatedBy}</div>
      </div>
      <div className="text-[10.5px] text-slate-400 mb-4">
        🔒 Snapshot — this report reflects the investigation exactly as it stood at generation time and will not
        change even if the site is updated later.
      </div>

      {snapshot.isPreliminary && (
        <div className="bg-red-50 border border-red-300 rounded px-3 py-2 text-xs text-red-900 font-semibold mb-4">
          ⚠ PRELIMINARY — Property identity had not been confirmed when this report was generated.
        </div>
      )}

      <div className="font-mono text-[12.5px] leading-relaxed space-y-4">
        <section>
          <div className="text-[11px] font-bold uppercase text-slate-500 mb-1">Property Identity</div>
          <div>Original input: {snapshot.identity.originalInputAddress ?? snapshot.identity.originalInputParcelRef}</div>
          <div>Matched address: {snapshot.identity.matchedAddress ?? '—'}</div>
          <div>Parcel: {snapshot.identity.parcelRef ?? 'Not confirmed'}</div>
          <div>Status: {snapshot.identity.identityStatus}</div>
          {snapshot.identity.matchConfidence !== null && (
            <div>Match confidence: {snapshot.identity.matchConfidence}% ({snapshot.identity.matchMethod})</div>
          )}
          <div>Confirmed by: {snapshot.identity.confirmedBy ?? '—'} {snapshot.identity.confirmedAt && `on ${new Date(snapshot.identity.confirmedAt).toLocaleDateString()}`}</div>
        </section>

        <section>
          <div className="text-[11px] font-bold uppercase text-slate-500 mb-1">Property Data</div>
          {snapshot.propertyData.map((f) => (
            <div key={f.fieldName}>
              {ck(f.status === 'confirmed')} {f.label}: {f.status === 'confirmed' ? String(f.value) : f.status}
              {f.source && ` — ${f.source}, retrieved ${f.retrievedAt ? new Date(f.retrievedAt).toLocaleDateString() : ''}`}
            </div>
          ))}
        </section>

        <section>
          <div className="text-[11px] font-bold uppercase text-slate-500 mb-1">Investigation Quality</div>
          <div>{ck(snapshot.investigationQuality.conflictingFields.length === 0)} Conflicts: {snapshot.investigationQuality.conflictingFields.join(', ') || 'none'}</div>
          <div>{ck(snapshot.investigationQuality.missingFields.length === 0)} Missing: {snapshot.investigationQuality.missingFields.join(', ') || 'none'}</div>
          <div>Sources used: {snapshot.investigationQuality.sourcesUsed.join(', ') || '—'}</div>
        </section>

        <section>
          <div className="text-[11px] font-bold uppercase text-slate-500 mb-1">Documents ({snapshot.documents.length})</div>
          {snapshot.documents.length === 0 && <div className="text-slate-400">None uploaded at time of generation.</div>}
          {snapshot.documents.map((d, i) => (
            <div key={i}>• {d.filename} ({d.category}) — {d.uploadedBy}, {new Date(d.uploadedAt).toLocaleDateString()}</div>
          ))}
        </section>

        <section>
          <div className="text-[11px] font-bold uppercase text-slate-500 mb-1">Analysis</div>
          <div className={snapshot.analysis.complete ? 'text-green-700 font-bold' : 'text-amber-700 font-bold'}>
            {snapshot.analysis.complete ? '✓ COMPLETE' : '⚠ INCOMPLETE'}
          </div>
          {snapshot.analysis.requiredActions.length > 0 && (
            <ol className="list-decimal list-inside mt-1">
              {snapshot.analysis.requiredActions.map((a, i) => <li key={i}>{a}</li>)}
            </ol>
          )}
          {snapshot.analysis.basedOnRun && (
            <div className="text-[11px] text-slate-400 mt-1">
              Based on analysis run {snapshot.analysis.basedOnRun.id.slice(0, 8)} ({snapshot.analysis.basedOnRun.status}
              {snapshot.analysis.basedOnRun.isPreliminary ? ', preliminary' : ''})
            </div>
          )}
        </section>

        <section>
          <div className="text-[11px] font-bold uppercase text-slate-500 mb-1">Audit Trail</div>
          {snapshot.auditTrail.map((e, i) => (
            <div key={i} className="text-slate-500">
              {new Date(e.createdAt).toLocaleString()} — {e.eventType.replace(/_/g, ' ')} {e.actor && `(${e.actor})`}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
