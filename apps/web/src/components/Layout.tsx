import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm ${isActive ? 'text-white font-semibold' : 'text-slate-400 hover:text-slate-200'}`;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 bg-slate-800 text-white flex items-center justify-between px-5 flex-shrink-0">
        <div className="flex items-center gap-8">
          <span className="font-bold tracking-wide text-sm">SITEIQ</span>
          <nav className="flex gap-6">
            <NavLink to="/" end className={linkClass}>Dashboard</NavLink>
            <NavLink to="/sites" className={linkClass}>Sites</NavLink>
            {user?.role === 'ADMIN' && (
              <NavLink to="/users" className={linkClass}>Users</NavLink>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-300">{user?.email} · {user?.role}</span>
          <button
            onClick={handleLogout}
            className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded"
          >
            Logout
          </button>
        </div>
      </header>
      <main className="flex-1 bg-slate-50">
        <Outlet />
      </main>
    </div>
  );
}
