import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@siteiq.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-slate-200 rounded-md shadow-sm w-[380px] p-9"
      >
        <div className="text-center mb-6">
          <div className="w-11 h-11 mx-auto mb-3 rounded-lg border-2 border-slate-800 flex items-center justify-center font-extrabold">
            SQ
          </div>
          <h1 className="text-lg font-bold">Sign in to SiteIQ</h1>
          <p className="text-xs text-slate-400 mt-1">Internal site-investigation platform</p>
        </div>

        {error && (
          <div className="mb-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </div>
        )}

        <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full border border-slate-300 rounded px-3 py-2 text-sm mb-4"
        />

        <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full border border-slate-300 rounded px-3 py-2 text-sm mb-6"
        />

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-slate-800 text-white rounded py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-center text-[11px] text-slate-400 mt-4">
          No self sign-up — accounts are created by an Administrator invite.
        </p>
      </form>
    </div>
  );
}
