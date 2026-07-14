import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './useAuth';

/** Redirects to the dashboard if the current role can't access this view. */
export function RequireView({ viewKey, children }: { viewKey: string; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(viewKey)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
