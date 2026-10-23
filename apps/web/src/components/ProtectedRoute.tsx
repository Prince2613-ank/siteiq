import type { ReactNode } from 'react';
import type { Role } from '../api/types';

export function ProtectedRoute({
  children,
}: {
  children: ReactNode;
  allow?: Role[];
}) {
  return <>{children}</>;
}
