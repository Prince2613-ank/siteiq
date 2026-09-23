import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../api/endpoints';
import { Badge } from '../components/Badge';
import { ApiError } from '../api/client';

export function UserManagement() {
  const queryClient = useQueryClient();
  const { data: users, isLoading } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('ANALYST');
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inviteMutation = useMutation({
    mutationFn: () => usersApi.invite(email, role),
    onSuccess: (res) => {
      setTempPassword(res.temporaryPassword);
      setEmail('');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Something went wrong.'),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      usersApi.update(id, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <div className="p-7 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold">
          Users &amp; permissions <span className="text-slate-400 font-normal text-sm">Admin only</span>
        </h1>
        <button onClick={() => setInviteOpen(true)} className="btn-primary">
          + Invite User
        </button>
      </div>

      {inviteOpen && (
        <div className="bg-white border border-slate-200 rounded p-5 mb-5">
          {tempPassword ? (
            <div>
              <div className="text-sm font-semibold mb-1">User created.</div>
              <div className="text-xs text-slate-500 mb-3">
                Temporary password (relay this out-of-band — it won't be shown again; a real
                email-invite flow arrives with Checkpoint 9's deployment/SES setup):
              </div>
              <code className="block bg-slate-100 rounded px-3 py-2 text-sm mb-3">{tempPassword}</code>
              <button
                onClick={() => {
                  setTempPassword(null);
                  setInviteOpen(false);
                }}
                className="btn"
              >
                Done
              </button>
            </div>
          ) : (
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <div className="text-[10px] font-semibold uppercase text-slate-500 mb-1">Email</div>
                <input value={email} onChange={(e) => setEmail(e.target.value)} className="input" type="email" />
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase text-slate-500 mb-1">Role</div>
                <select value={role} onChange={(e) => setRole(e.target.value)} className="input">
                  <option value="ADMIN">Administrator</option>
                  <option value="ANALYST">Analyst</option>
                  <option value="VIEWER">Viewer</option>
                </select>
              </div>
              <button
                onClick={() => {
                  setError(null);
                  inviteMutation.mutate();
                }}
                disabled={!email || inviteMutation.isPending}
                className="btn-primary"
              >
                {inviteMutation.isPending ? 'Creating…' : 'Create'}
              </button>
              <button onClick={() => setInviteOpen(false)} className="btn">Cancel</button>
            </div>
          )}
          {error && <div className="text-xs text-red-600 mt-3">{error}</div>}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase text-slate-500 border-b border-slate-200">
              <th className="text-left px-3 py-2">Email</th>
              <th className="text-left px-3 py-2">Role</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Created</th>
              <th className="text-right px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="text-center py-6 text-slate-400">Loading…</td></tr>}
            {users?.map((u) => (
              <tr key={u.id} className="border-b border-slate-100">
                <td className="px-3 py-2.5">{u.email}</td>
                <td className="px-3 py-2.5"><Badge value={u.role} /></td>
                <td className="px-3 py-2.5">
                  {u.isActive ? (
                    <span className="text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">Active</span>
                  ) : (
                    <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-dashed border-slate-300">Deactivated</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-[11px] text-slate-400">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => toggleActiveMutation.mutate({ id: u.id, isActive: !u.isActive })}
                    className="text-xs text-blue-700"
                  >
                    {u.isActive ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400 mt-3">
        Deactivating a user does not delete their work — any sites assigned to them become
        unassigned and remain visible to the team for reassignment.
      </p>
    </div>
  );
}
