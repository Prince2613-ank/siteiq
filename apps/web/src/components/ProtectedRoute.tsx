import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Role } from '../api/types';

export function ProtectedRoute({
  children,
  allow,
}: {
  children: React.ReactNode;
  allow?: Role[];
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (allow && !allow.includes(user.role)) {
    return (
      <div className="p-8 text-sm text-red-600">
        You don't have permission to view this page.
      </div>
    );
  }
  return <>{children}</>;
}
