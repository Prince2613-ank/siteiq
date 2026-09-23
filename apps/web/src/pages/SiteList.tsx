import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { sitesApi } from '../api/endpoints';
import { Badge } from '../components/Badge';

export function SiteList() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['sites', 'list', search, status],
    queryFn: () => sitesApi.list({ search: search || undefined, investigationStatus: status || undefined }),
  });

  const sites = data?.items ?? [];

  return (
    <div className="p-7 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold">
          Sites <span className="text-slate-400 font-normal text-sm">{sites.length} results</span>
        </h1>
        <Link to="/sites/new" className="bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded">
          + Create Site
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded p-3 mb-4 flex gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or address…"
          className="flex-1 border border-dashed border-slate-400 bg-slate-50 rounded px-3 py-1.5 text-sm"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border border-slate-300 rounded px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          <option value="NEW">New</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="NEEDS_REVIEW">Needs review</option>
          <option value="COMPLETED">Completed</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase text-slate-500 border-b border-slate-200">
              <th className="text-left px-3 py-2">Site</th>
              <th className="text-left px-3 py-2">Municipality</th>
              <th className="text-left px-3 py-2">Identity</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Assigned</th>
              <th className="text-left px-3 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Loading…</td></tr>
            )}
            {!isLoading && sites.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">No sites match.</td></tr>
            )}
            {sites.map((site) => (
              <tr key={site.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2.5">
                  <Link to={`/sites/${site.id}`} className="font-semibold text-slate-800 hover:underline">
                    {site.name || site.streetAddress}
                  </Link>
                  <div className="text-[11px] text-slate-400">{site.streetAddress}, {site.city}, {site.state} {site.zip}</div>
                </td>
                <td className="px-3 py-2.5">{site.municipality}</td>
                <td className="px-3 py-2.5"><Badge value={site.identityStatus} /></td>
                <td className="px-3 py-2.5"><Badge value={site.investigationStatus} /></td>
                <td className="px-3 py-2.5">{site.assignedAnalyst?.email ?? <span className="text-slate-400">Unassigned</span>}</td>
                <td className="px-3 py-2.5 text-[11px] text-slate-400">{new Date(site.updatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
