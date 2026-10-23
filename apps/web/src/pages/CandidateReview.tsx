import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { sitesApi } from '../api/endpoints';
import { matchingApi, MatchCandidate } from '../api/matching';
import { Badge } from '../components/Badge';
import { ParcelMap } from '../components/ParcelMap';
import { ApiError } from '../api/client';

export function CandidateReview() {
  const { id: siteId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: site, error: siteError, refetch: reloadSite } = useQuery({
    queryKey: ['sites', siteId],
    queryFn: () => sitesApi.get(siteId!),
    enabled: !!siteId,
    refetchInterval: (query) =>
      query.state.data?.identityStatus === 'IDENTIFYING' ? 1200 : false,
  });

  const { data: attempts } = useQuery({
    queryKey: ['matching', 'attempts', siteId],
    queryFn: () => matchingApi.listAttempts(siteId!),
    enabled: !!siteId && site?.identityStatus !== 'IDENTIFYING',
  });
  const latestAttempt = attempts?.[0];

  const { data: candidates } = useQuery({
    queryKey: ['matching', 'candidates', siteId, latestAttempt?.id],
    queryFn: () => matchingApi.listCandidates(siteId!, latestAttempt!.id),
    enabled: !!siteId && !!latestAttempt,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [duplicateDecision, setDuplicateDecision] = useState<'OPENED_EXISTING' | 'CONTINUED_SEPARATE' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => candidates?.find((c) => c.id === selectedId) ?? null,
    [candidates, selectedId],
  );

  // Top candidate pre-selected (docs/02 §2.2) — but nothing is confirmed
  // until the analyst explicitly clicks Confirm, regardless of rank.
  useEffect(() => {
    if (candidates && candidates.length > 0 && selectedId === null) {
      setSelectedId(candidates[0].id);
    }
  }, [candidates, selectedId]);

  const isReMatchConflict = !!site?.confirmedCandidateId && site?.identityStatus === 'NEEDS_REVIEW';

  const confirmMutation = useMutation({
    mutationFn: () =>
      matchingApi.confirm(siteId!, latestAttempt!.id, selected!.id, {
        note: note || undefined,
        duplicateDecision: selected?.duplicateOfSiteId ? duplicateDecision ?? undefined : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites', siteId] });
      navigate(`/sites/${siteId}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Something went wrong.'),
  });

  const rejectAllMutation = useMutation({
    mutationFn: () => matchingApi.rejectAll(siteId!, latestAttempt!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites', siteId] });
      navigate(`/sites/${siteId}`);
    },
  });

  if (siteError) return <div role="alert" className="p-8 text-sm text-slate-600">
    <p>{siteError instanceof ApiError ? siteError.message : 'Site information could not be loaded.'}</p>
    <button className="mt-3 btn" onClick={() => reloadSite()}>Try again</button>
    <Link className="ml-3 text-blue-600" to="/sites">Back to Sites</Link>
  </div>;
  if (!site) return <div className="p-8 text-sm text-slate-400">Loading…</div>;

  if (site.identityStatus === 'IDENTIFYING') {
    return (
      <div className="p-10 max-w-xl mx-auto text-center">
        <div className="text-lg font-bold mb-2">Investigating {site.originalInputAddress}…</div>
        <div className="text-sm text-slate-500">
          SiteIQ is searching Massachusetts parcel data. This usually takes a few seconds.
        </div>
      </div>
    );
  }

  if (site.identityStatus === 'CONFIRMED' || site.identityStatus === 'MANUAL') {
    return (
      <div className="p-10 max-w-xl mx-auto text-center">
        <div className="text-sm text-slate-500 mb-3">
          This site's identity is already {site.identityStatus === 'CONFIRMED' ? 'confirmed' : 'set to manual entry'}.
        </div>
        <Link to={`/sites/${siteId}`} className="btn-primary">Go to Site Details</Link>
      </div>
    );
  }

  if (site.identityStatus === 'NO_MATCH' || (candidates && candidates.length === 0)) {
    return (
      <div className="p-10 max-w-xl mx-auto">
        <div className="bg-white border border-slate-200 rounded p-8 text-center">
          <div className="text-lg font-bold mb-2">No reliable property match found</div>
          <p className="text-sm text-slate-500 mb-6">
            We searched the available sources but couldn't identify the property with sufficient
            confidence. You can continue the investigation manually.
          </p>
          <div className="flex justify-center gap-2">
            <button onClick={() => navigate('/sites/new')} className="btn">Try another address</button>
            <button
              onClick={() => latestAttempt && rejectAllMutation.mutate()}
              disabled={!latestAttempt || rejectAllMutation.isPending}
              className="btn-primary"
            >
              Continue Manually
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="text-[11px] text-slate-400 mb-1">Sites › New investigation › Candidate Review</div>
        <div className="text-lg font-bold">SiteIQ found {candidates?.length ?? 0} possible parcels</div>
        {isReMatchConflict && (
          <div className="mt-2 bg-red-50 border border-red-300 rounded px-3 py-2 text-xs text-red-900">
            ⚠ This site already has a confirmed parcel (<strong>{site.parcelRef}</strong>). These new
            results differ — the confirmed parcel will only change if you explicitly confirm one of
            the candidates below.
          </div>
        )}
      </div>

      <div className="flex">
        <div className="w-[640px] p-6 space-y-3">
          <div className="bg-slate-50 border border-slate-200 rounded p-3 mb-2">
            <div className="text-[10px] font-semibold uppercase text-slate-500 mb-1">
              Original input (preserved, never overwritten)
            </div>
            <div className="text-sm font-semibold">{site.originalInputAddress}</div>
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
          )}

          {candidates?.map((c) => (
            <CandidateCard
              key={c.id}
              candidate={c}
              allCandidates={candidates}
              selected={selectedId === c.id}
              onSelect={() => {
                setSelectedId(c.id);
                setDuplicateDecision(null);
                setError(null);
              }}
              duplicateDecision={duplicateDecision}
              onDuplicateDecision={setDuplicateDecision}
            />
          ))}

          <div className="text-center text-xs text-blue-700 pt-1">
            <button onClick={() => latestAttempt && rejectAllMutation.mutate()} className="underline">
              None of these are correct — enter manually
            </button>
          </div>
        </div>

        <div className="flex-1 p-6">
          <div className="bg-white border border-slate-200 rounded p-4 mb-4">
            <div className="text-[10px] font-semibold uppercase text-slate-500 mb-2">Optional note</div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why did you choose this candidate? (optional)"
              className="input"
            />
          </div>
          <div className="bg-white border border-slate-200 rounded p-2 mb-4">
            <ParcelMap
              height={320}
              candidates={(candidates ?? []).map((c) => ({
                id: c.id,
                label: String(c.rank),
                confidence: c.confidence,
                selected: c.id === selectedId,
                geometry: c.geometry,
                onClick: () => {
                  setSelectedId(c.id);
                  setDuplicateDecision(null);
                  setError(null);
                },
              }))}
            />
            <div className="text-[10px] text-slate-400 mt-1 px-1">
              Real parcel boundaries from the local PostGIS mirror. Dark solid = selected, gray
              dashed = other candidates. Click a boundary or marker to select it.
            </div>
          </div>
          <button
            onClick={() => {
              setError(null);
              if (selected?.duplicateOfSiteId && !duplicateDecision) {
                setError('This parcel already has an active site — choose Open existing or Continue as separate above.');
                return;
              }
              confirmMutation.mutate();
            }}
            disabled={!selected || confirmMutation.isPending}
            className="btn-primary w-full"
          >
            {confirmMutation.isPending ? 'Confirming…' : 'Confirm Selected Parcel'}
          </button>
          <div className="text-[11px] text-slate-400 mt-2 text-center">
            Nothing is finalized until you click Confirm — even a 99% match waits for you.
          </div>
        </div>
      </div>
    </div>
  );
}

function CandidateCard({
  candidate,
  allCandidates,
  selected,
  onSelect,
  duplicateDecision,
  onDuplicateDecision,
}: {
  candidate: MatchCandidate;
  allCandidates: MatchCandidate[];
  selected: boolean;
  onSelect: () => void;
  duplicateDecision: 'OPENED_EXISTING' | 'CONTINUED_SEPARATE' | null;
  onDuplicateDecision: (d: 'OPENED_EXISTING' | 'CONTINUED_SEPARATE') => void;
}) {
  const e = candidate.evidence;
  const band = candidate.confidence >= 90 ? 'HIGH' : candidate.confidence >= 60 ? 'REVIEW' : 'LOW';
  const conflictCounterpart = e.conflictingCandidateParcelRef
    ? allCandidates.find((c) => c.parcelRef === e.conflictingCandidateParcelRef)
    : null;

  return (
    <div
      onClick={onSelect}
      className={`bg-white border rounded p-4 cursor-pointer ${
        selected ? 'border-2 border-slate-800' : 'border-slate-200'
      }`}
    >
      <div className="flex justify-between items-start">
        <div className="flex gap-2.5">
          <div
            className={`w-4 h-4 rounded-full border-2 mt-0.5 flex-shrink-0 ${
              selected ? 'border-slate-800 bg-slate-800' : 'border-slate-400'
            }`}
          />
          <div>
            <div className="text-sm font-extrabold">#{candidate.rank} · {candidate.matchedAddress}</div>
            <div className="text-[11px] text-slate-500">{candidate.parcelRef} · {candidate.municipality}</div>
          </div>
        </div>
        <Badge
          value={band === 'HIGH' ? 'CONFIRMED' : band === 'REVIEW' ? 'NEEDS_REVIEW' : 'NO_MATCH'}
          label={`${candidate.confidence}% ${band === 'HIGH' ? 'High confidence' : band === 'REVIEW' ? 'Needs review' : 'Low'}`}
        />
      </div>

      {(e.lowCorroboration || e.addressEvidenceConflict || e.conflictDetected) && (
        <div className="ml-6 mt-2 bg-amber-50 border border-amber-300 rounded px-2.5 py-1.5 text-[11px] text-amber-900">
          {e.identityEvidenceConflict || e.conflictDetected ? (
            <>⚠ Evidence conflict — address and coordinate evidence identify different parcels. Manual verification required.</>
          ) : e.addressEvidenceConflict ? (
            <>⚠ Evidence conflict — the coordinate and the property address point to different information. Manual verification required.</>
          ) : (
            <>⚠ Low corroboration — location identified, but insufficient address evidence to confidently identify the property. Manual verification required.</>
          )}
        </div>
      )}

      {e.identityEvidenceConflict && (
        <div className="ml-6 mt-2 grid grid-cols-2 gap-2 text-[10.5px]">
          <div className="border border-slate-200 rounded p-2 bg-slate-50">
            <div className="font-semibold text-slate-600 mb-1">
              {e.agreement === 'ADDRESS_ONLY' || (e.houseNumberMatch === true && !e.addressEvidenceConflict) ? 'This candidate — address evidence' : 'This candidate — spatial evidence'}
            </div>
            <div>{candidate.matchedAddress}, {candidate.municipality}</div>
            <div>House number: {e.houseNumberMatch === null ? '—' : e.houseNumberMatch ? 'match' : 'mismatch'}</div>
            <div>Street: {e.streetSuffixMatch === null ? '—' : e.streetSuffixMatch ? 'match' : 'mismatch'}</div>
            <div>Distance: {e.distanceMeters !== null ? `${Math.round(e.distanceMeters)}m` : '—'}</div>
            <div>Point-in-parcel: {e.pointInParcel === null ? '—' : e.pointInParcel ? 'yes' : 'no'}</div>
            <div>Evidence strength: address={e.addressEvidenceStrength}, spatial={e.spatialEvidenceStrength}</div>
          </div>
          {conflictCounterpart && (
            <div className="border border-slate-200 rounded p-2 bg-slate-50">
              <div className="font-semibold text-slate-600 mb-1">Conflicting candidate</div>
              <div>{conflictCounterpart.matchedAddress}, {conflictCounterpart.municipality}</div>
              <div>House number: {conflictCounterpart.evidence.houseNumberMatch === null ? '—' : conflictCounterpart.evidence.houseNumberMatch ? 'match' : 'mismatch'}</div>
              <div>Street: {conflictCounterpart.evidence.streetSuffixMatch === null ? '—' : conflictCounterpart.evidence.streetSuffixMatch ? 'match' : 'mismatch'}</div>
              <div>Distance: {conflictCounterpart.evidence.distanceMeters !== null ? `${Math.round(conflictCounterpart.evidence.distanceMeters)}m` : '—'}</div>
              <div>Point-in-parcel: {conflictCounterpart.evidence.pointInParcel === null ? '—' : conflictCounterpart.evidence.pointInParcel ? 'yes' : 'no'}</div>
              <div>Evidence strength: address={conflictCounterpart.evidence.addressEvidenceStrength}, spatial={conflictCounterpart.evidence.spatialEvidenceStrength}</div>
            </div>
          )}
        </div>
      )}

      <div className="ml-6 mt-2 text-[11.5px] leading-relaxed">
        <EvidenceLine ok={e.addressSimilarity !== null && e.addressSimilarity > 0.6} label={`Street address match${e.addressSimilarity !== null ? ` (${Math.round(e.addressSimilarity * 100)}% similar)` : ''}`} shown={e.addressSimilarity !== null} />
        <EvidenceLine
          ok={e.locationTextSimilarity !== null && e.locationTextSimilarity > 0.6}
          label={`Street/location clue match${e.locationTextSimilarity !== null ? ` (${Math.round(e.locationTextSimilarity * 100)}% similar)` : ''}`}
          shown={e.locationTextSimilarity !== null}
        />
        <EvidenceLine ok={!!e.houseNumberMatch} label="House number match" shown={e.houseNumberMatch !== null} />
        <EvidenceLine ok={!!e.streetSuffixMatch} label="Street type (suffix) match" shown={e.streetSuffixMatch !== null} />
        <EvidenceLine ok={!!e.municipalityMatch} label="Municipality match" shown={e.municipalityMatch !== null} />
        <EvidenceLine ok={!!e.parcelIdMatch} label="Parcel ID confirmed" shown={e.parcelIdMatch !== null} />
        <EvidenceLine ok={!!e.pointInParcel} label="Coordinate falls inside this parcel" shown={e.pointInParcel !== null} />
        <EvidenceLine
          ok={e.distanceMeters !== null && e.distanceMeters < 50}
          label={e.distanceMeters !== null ? `${Math.round(e.distanceMeters)}m from supplied location` : ''}
          shown={e.distanceMeters !== null}
        />
      </div>
      <div className="ml-6 mt-1.5 text-[10.5px] flex items-center gap-2 flex-wrap">
        <span className="text-slate-400">
          Source: {e.sourceName} · refreshed {new Date(e.retrievedAt).toLocaleDateString()}
        </span>
        <FreshnessBadge ageDays={e.sourceAgeDays} />
        {e.searchRadiusMeters !== null && (
          <span className="text-slate-400">· found within {e.searchRadiusMeters}m search radius</span>
        )}
      </div>

      {selected && candidate.duplicateOfSiteId && (
        <div className="ml-6 mt-3 bg-amber-50 border border-amber-300 rounded p-3" onClick={(ev) => ev.stopPropagation()}>
          <div className="text-[11.5px] font-bold text-amber-900 mb-1">⚠ Possible duplicate</div>
          <div className="text-[11.5px] text-amber-900 mb-2">
            An active site already exists for parcel {candidate.parcelRef}:{' '}
            {candidate.duplicateOfSite?.streetAddress}, {candidate.duplicateOfSite?.city}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onDuplicateDecision('OPENED_EXISTING')}
              className={`text-xs px-3 py-1.5 rounded border ${duplicateDecision === 'OPENED_EXISTING' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300'}`}
            >
              Open existing site
            </button>
            <button
              onClick={() => onDuplicateDecision('CONTINUED_SEPARATE')}
              className={`text-xs px-3 py-1.5 rounded border ${duplicateDecision === 'CONTINUED_SEPARATE' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300'}`}
            >
              Continue as separate site
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Source freshness, shown deliberately SEPARATE from the confidence badge
 * (client requirement) — a high match confidence doesn't imply the
 * underlying parcel data is current. Confidence describes how sure SiteIQ
 * is this is the right parcel; this describes how old that parcel's
 * source data is. Two different questions, two different badges.
 */
function FreshnessBadge({ ageDays }: { ageDays: number }) {
  if (ageDays <= 30) {
    return <span className="text-[10px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">fresh</span>;
  }
  if (ageDays <= 180) {
    return <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">{ageDays}d old</span>;
  }
  return (
    <span className="text-[10px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded-full">
      ⚠ {Math.round(ageDays / 30)}mo old
    </span>
  );
}

function EvidenceLine({ ok, label, shown }: { ok: boolean; label: string; shown: boolean }) {
  if (!shown || !label) return null;
  return (
    <div className={ok ? 'text-green-700' : 'text-slate-400'}>
      {ok ? '✓' : '○'} {label}
    </div>
  );
}
