import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { sitesApi } from '../api/endpoints';
import { Badge } from '../components/Badge';
import { useAuth } from '../context/AuthContext';

export function Dashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['sites', 'dashboard'],
    queryFn: () => sitesApi.list(),
  });

  const sites = data?.items ?? [];
  const needsReview = sites.filter((s) => s.investigationStatus === 'NEEDS_REVIEW').length;
  const unassigned = sites.filter((s) => !s.assignedAnalystId).length;

  return (
    <div className="p-7 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Welcome back, {user?.email}</h1>
        <Link
          to="/sites/new"
          className="bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded"
        >
          + Create Site
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatTile n={sites.length} label="Active sites" />
        <StatTile n={needsReview} label="Needs review" />
        <StatTile n={unassigned} label="Unassigned sites" />
        <StatTile n={sites.filter((s) => s.identityStatus === 'CONFIRMED').length} label="Confirmed identity" />
      </div>

      <div className="bg-white border border-slate-200 rounded p-4">
        <div className="flex justify-between mb-3">
          <span className="text-sm font-bold">Recently updated sites</span>
          <Link to="/sites" className="text-xs text-blue-700">View all →</Link>
        </div>
        {isLoading && <div className="text-sm text-slate-400">Loading…</div>}
        {!isLoading && sites.length === 0 && (
          <div className="text-sm text-slate-400">No sites yet — create your first investigation.</div>
        )}
        <div className="divide-y divide-slate-100">
          {sites.slice(0, 8).map((site) => (
            <Link
              to={`/sites/${site.id}`}
              key={site.id}
              className="flex items-center gap-3 py-2.5 text-sm hover:bg-slate-50 -mx-2 px-2 rounded"
            >
              <span className="flex-1">
                {site.name || site.streetAddress} — {site.city}, {site.state}
              </span>
              <Badge value={site.investigationStatus} />
              <span className="w-28 text-[11px] text-slate-400 text-right">
                {new Date(site.updatedAt).toLocaleDateString()}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatTile({ n, label }: { n: number; label: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded p-4">
      <div className="text-2xl font-extrabold">{n}</div>
      <div className="text-[11px] text-slate-500 mt-1">{label}</div>
    </div>
  );
}
