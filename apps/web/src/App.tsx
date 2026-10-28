import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { SiteList } from './pages/SiteList';
import { ParcelReport } from './pages/ParcelReport';
import { PARCEL_REPORT_ROUTE, COUNTRY_CLUB_REPORT_PATH } from './utils/parcelReports';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function AppProviders() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppProviders />}>
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/users" element={<Navigate to="/" replace />} />
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/sites" element={<SiteList />} />
              <Route path={PARCEL_REPORT_ROUTE} element={<ParcelReport />} />
              <Route path={COUNTRY_CLUB_REPORT_PATH} element={<ParcelReport />} />
              <Route path="/sites/new" element={<Navigate to="/" replace />} />
              <Route path="/sites/:id" element={<Navigate to="/" replace />} />
              <Route path="/sites/:id/candidates" element={<Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
