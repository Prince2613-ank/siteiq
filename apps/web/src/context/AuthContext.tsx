import { createContext, useContext, ReactNode } from 'react';
import type { AuthUser } from '../api/types';

export const DEFAULT_USER: AuthUser = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'admin@siteiq.local',
  role: 'ADMIN',
  organizationId: '00000000-0000-0000-0000-000000000001',
};

interface AuthContextValue {
  user: AuthUser;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Always active admin user — no login/logout required
  return (
    <AuthContext.Provider
      value={{
        user: DEFAULT_USER,
        loading: false,
        login: async () => {},
        logout: async () => {},
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
