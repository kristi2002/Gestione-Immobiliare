import { useEffect, useMemo, type ReactNode } from 'react';
import { setCsrfToken, setUnauthorizedHandler } from '@/lib/api/client';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { AuthContext, type AuthContextValue } from './AuthContext';
import { useMeQuery } from './api';

/** Where the browser goes when there is no valid session. */
function redirectToLogin() {
  const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login.php?return=${returnTo}`;
}

/**
 * Gates the whole app behind a valid admin session.
 *  - shows a loader while GET /api/me is in flight
 *  - on 401 (or any auth error) redirects to the PHP login
 *  - on success hydrates the CSRF token and exposes user + permissions
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, isError } = useMeQuery();

  // Any 401 from any later request also bounces to login.
  useEffect(() => {
    setUnauthorizedHandler(redirectToLogin);
    return () => setUnauthorizedHandler(null);
  }, []);

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
    // The api client's 401 handler already triggered the redirect; render a
    // loader rather than flashing an error while the navigation happens.
    redirectToLogin();
    return <FullScreenLoader />;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
