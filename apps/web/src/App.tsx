import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { SiteList } from './pages/SiteList';
import { CreateSite } from './pages/CreateSite';
import { SiteDetails } from './pages/SiteDetails';
import { CandidateReview } from './pages/CandidateReview';
import { UserManagement } from './pages/UserManagement';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/sites" element={<SiteList />} />
              <Route path="/sites/new" element={<CreateSite />} />
              <Route path="/sites/:id" element={<SiteDetails />} />
              <Route path="/sites/:id/candidates" element={<CandidateReview />} />
              <Route
                path="/users"
                element={
                  <ProtectedRoute allow={['ADMIN']}>
                    <UserManagement />
                  </ProtectedRoute>
                }
              />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
