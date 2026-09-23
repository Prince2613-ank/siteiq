import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { sitesApi, usersApi } from '../api/endpoints';
import { ApiError } from '../api/client';

export function CreateSite() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    streetAddress: '',
    city: '',
    state: 'MA',
    zip: '',
    parcelRef: '',
    lat: '',
    lng: '',
    locationText: '',
    locationDescription: '',
    facilityId: '',
    assignedAnalystId: '',
  });
  const [error, setError] = useState<string | null>(null);

  const { data: users } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });

  const createMutation = useMutation({
    mutationFn: () =>
      sitesApi.create({
        ...form,
        streetAddress: form.streetAddress || undefined,
        name: form.name || undefined,
        zip: form.zip || undefined,
        parcelRef: form.parcelRef || undefined,
        lat: form.lat ? Number(form.lat) : undefined,
        lng: form.lng ? Number(form.lng) : undefined,
        locationText: form.locationText || undefined,
        locationDescription: form.locationDescription || undefined,
        facilityId: form.facilityId || undefined,
        assignedAnalystId: form.assignedAnalystId || undefined,
      }),
    onSuccess: (site) => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      // Automated matching (Checkpoint 5) always runs — never route straight
      // to Site Details as if the identity were already known.
      navigate(`/sites/${site.id}/candidates`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Something went wrong.'),
  });

  return (
    <div className="p-7 max-w-2xl mx-auto">
      <div className="bg-white border border-slate-200 rounded p-8">
        <h1 className="text-lg font-bold mb-1">Create a new site</h1>
        <p className="text-xs text-slate-400 mb-6">
          Massachusetts only for this release.
        </p>

        {error && (
          <div className="mb-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </div>
        )}

        <Field label="Internal nickname (optional)">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="input"
            placeholder='e.g. "Elm St. mixed-use parcel"'
          />
        </Field>
        <Field label="Street address (optional — not always known; SiteIQ can identify the property from the clues below instead)">
          <input
            value={form.streetAddress}
            onChange={(e) => setForm({ ...form, streetAddress: e.target.value })}
            className="input"
          />
        </Field>
        <div className="flex gap-3">
          <Field label="City / Municipality (town)" className="flex-[2]">
            <input
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              className="input"
              required
            />
          </Field>
          <Field label="State" className="flex-1">
            <input
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })}
              className="input"
              maxLength={2}
            />
          </Field>
          <Field label="ZIP" className="flex-1">
            <input
              value={form.zip}
              onChange={(e) => setForm({ ...form, zip: e.target.value })}
              className="input"
            />
          </Field>
        </div>
        <Field label="Parcel / assessor reference (optional — used instead of address matching if provided)">
          <input
            value={form.parcelRef}
            onChange={(e) => setForm({ ...form, parcelRef: e.target.value })}
            className="input"
            placeholder="e.g. 04-112-0034"
          />
        </Field>

        <div className="bg-slate-50 border border-slate-200 rounded p-4 mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 mb-1">
            No exact address? Use location clues instead
          </div>
          <p className="text-[11px] text-slate-500 mb-3">
            SiteIQ can identify the property from coordinates, a street/location name, and a free-text
            description — the same way field records often report a site.
          </p>
          <div className="flex gap-3">
            <Field label="Latitude" className="flex-1">
              <input
                value={form.lat}
                onChange={(e) => setForm({ ...form, lat: e.target.value })}
                className="input"
                placeholder="e.g. 42.717960"
              />
            </Field>
            <Field label="Longitude" className="flex-1">
              <input
                value={form.lng}
                onChange={(e) => setForm({ ...form, lng: e.target.value })}
                className="input"
                placeholder="e.g. -71.142581"
              />
            </Field>
          </div>
          <Field label="Street / location name">
            <input
              value={form.locationText}
              onChange={(e) => setForm({ ...form, locationText: e.target.value })}
              className="input"
              placeholder="e.g. Marston St"
            />
          </Field>
          <Field label="Location description (supporting evidence only)">
            <input
              value={form.locationDescription}
              onChange={(e) => setForm({ ...form, locationDescription: e.target.value })}
              className="input"
              placeholder='e.g. "0.25 mi S of Methuen-Lawrence TL on Marston St"'
            />
          </Field>
          <Field label="Facility ID (optional — your source system's own record identifier)">
            <input
              value={form.facilityId}
              onChange={(e) => setForm({ ...form, facilityId: e.target.value })}
              className="input"
            />
          </Field>
        </div>

        <Field label="Assign to analyst (optional, informational only)">
          <select
            value={form.assignedAnalystId}
            onChange={(e) => setForm({ ...form, assignedAnalystId: e.target.value })}
            className="input"
          >
            <option value="">Unassigned</option>
            {users?.filter((u) => u.role !== 'VIEWER' && u.isActive).map((u) => (
              <option key={u.id} value={u.id}>{u.email}</option>
            ))}
          </select>
        </Field>

        <div className="bg-slate-50 border border-slate-200 rounded p-3 text-[11px] text-slate-500 mb-6">
          <div className="font-semibold text-slate-600 mb-1">What happens after you submit</div>
          Site created → SiteIQ automatically searches Massachusetts parcel data → you review
          ranked candidates and confirm the correct parcel yourself. Nothing is finalized
          automatically, even for a very confident match.
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={() => navigate(-1)} className="btn">Cancel</button>
          <button
            onClick={() => {
              setError(null);
              createMutation.mutate();
            }}
            disabled={
              !form.city ||
              !(form.streetAddress || form.parcelRef || (form.lat && form.lng) || form.locationText) ||
              createMutation.isPending
            }
            className="btn-primary"
          >
            {createMutation.isPending ? 'Creating…' : 'Create Site'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-4 ${className}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}
