import { lazy } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { RequireView } from '@/features/auth/RequireView';
import { ALL_NAV_ITEMS } from '@/config/navigation';

// Route-level code splitting: each page (and its deps, e.g. recharts on the
// dashboard) loads only when navigated to. Suspense fallback lives in AppLayout.
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const PlaceholderPage = lazy(() => import('@/pages/PlaceholderPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

// Auth gate wraps the layout so the whole app requires a valid session.
function GatedLayout() {
  return (
    <AuthProvider>
      <AppLayout />
    </AuthProvider>
  );
}

// Every nav item except the dashboard renders a placeholder until its real
// feature page ships in a later phase. Each is permission-guarded to mirror
// the backend role map.
const featureRoutes: RouteObject[] = ALL_NAV_ITEMS.filter((item) => item.key !== 'dashboard').map(
  (item) => ({
    path: item.path.replace(/^\//, ''),
    element: (
      <RequireView viewKey={item.key}>
        <PlaceholderPage title={item.label} icon={item.icon} />
      </RequireView>
    ),
  }),
);

export const router = createBrowserRouter(
  [
    {
      element: <GatedLayout />,
      children: [
        { index: true, element: <DashboardPage /> },
        ...featureRoutes,
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ],
  { basename: '/app' },
);
