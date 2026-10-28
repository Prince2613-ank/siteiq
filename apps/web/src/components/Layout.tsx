import { NavLink, Outlet, Link } from 'react-router-dom';

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans">
      <header className="h-14 bg-slate-900 border-b border-slate-800 text-white flex items-center px-6 flex-shrink-0 sticky top-0 z-40">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center group">
            <span className="font-extrabold tracking-widest text-base text-white hover:text-blue-400 transition-colors">
              SiteIQ
            </span>
          </Link>

          <nav className="flex items-center gap-6">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `text-sm tracking-wide font-medium transition-colors ${
                  isActive
                    ? 'text-slate-400'
                    : 'text-white font-bold hover:text-slate-200'
                }`
              }
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/sites"
              className={({ isActive }) =>
                `text-sm tracking-wide font-medium transition-colors ${
                  isActive
                    ? 'text-slate-400'
                    : 'text-white font-bold hover:text-slate-200'
                }`
              }
            >
              Sites
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
