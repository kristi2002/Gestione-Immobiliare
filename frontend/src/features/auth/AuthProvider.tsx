import { useEffect, useMemo, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { setCsrfToken, setUnauthorizedHandler } from '@/lib/api/client';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { AuthContext, type AuthContextValue } from './AuthContext';
import { useMeQuery } from './api';

/**
 * Gates the whole app behind a valid admin session.
 *  - shows a loader while GET /api/me is in flight
 *  - on 401 (or any auth error) redirects to the React login route
 *  - on success hydrates the CSRF token and exposes user + permissions
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, isError } = useMeQuery();
  const navigate = useNavigate();
  const location = useLocation();

  // A 401 from a request made AFTER the initial load (session expired mid-use)
  // also bounces to login — imperative navigate() since it fires outside render.
  useEffect(() => {
    const redirectToLogin = () => {
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
      navigate(`/login?return=${returnTo}`, { replace: true });
    };
    setUnauthorizedHandler(redirectToLogin);
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  // Hydrate the CSRF token for mutating requests.
  useEffect(() => {
    if (data?.csrf_token) setCsrfToken(data.csrf_token);
  }, [data?.csrf_token]);

  const value = useMemo<AuthContextValue | null>(() => {
    if (!data) return null;
    const isSuper = data.permissions.includes('*');
    return {
      user: data.user,
      permissions: data.permissions,
      can: (viewKey: string) => isSuper || data.permissions.includes(viewKey),
    };
  }, [data]);

  if (isLoading) return <FullScreenLoader />;

  if (isError || !value) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?return=${returnTo}`} replace />;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
