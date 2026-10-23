import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { SiteList } from './pages/SiteList';
import { CreateSite } from './pages/CreateSite';
import { SiteDetails } from './pages/SiteDetails';
import { CandidateReview } from './pages/CandidateReview';
import { ParcelExplorer, ParcelReport } from './pages/ParcelExplorer';

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
          <Route path="/parcel-explorer" element={<ParcelExplorer />} />
          <Route path="/parcel-explorer/:slug" element={<ParcelReport />} />
          <Route element={<AppProviders />}>
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/users" element={<Navigate to="/" replace />} />
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/sites" element={<SiteList />} />
              <Route path="/sites/new" element={<CreateSite />} />
              <Route path="/sites/:id" element={<SiteDetails />} />
              <Route path="/sites/:id/candidates" element={<CandidateReview />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
