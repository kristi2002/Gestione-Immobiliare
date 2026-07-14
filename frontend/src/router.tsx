import { lazy } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { RequireView } from '@/features/auth/RequireView';
import { ALL_NAV_ITEMS } from '@/config/navigation';

// Route-level code splitting: each page (and its deps, e.g. recharts on the
// dashboard) loads only when navigated to. Suspense fallback lives in AppLayout.
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const PropertiesPage = lazy(() => import('@/features/properties/PropertiesPage'));
const PropertyDetailPage = lazy(() => import('@/features/properties/PropertyDetailPage'));
const PlaceholderPage = lazy(() => import('@/pages/PlaceholderPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

/** View keys handled by real React pages (skip the placeholder generator). */
const IMPLEMENTED = new Set(['dashboard', 'properties']);

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
const placeholderRoutes: RouteObject[] = ALL_NAV_ITEMS.filter(
  (item) => !IMPLEMENTED.has(item.key),
).map((item) => ({
  path: item.path.replace(/^\//, ''),
  element: (
    <RequireView viewKey={item.key}>
      <PlaceholderPage title={item.label} icon={item.icon} />
    </RequireView>
  ),
}));

const propertyRoutes: RouteObject[] = [
  {
    path: 'properties',
    element: (
      <RequireView viewKey="properties">
        <PropertiesPage />
      </RequireView>
    ),
  },
  {
    path: 'properties/:id',
    element: (
      <RequireView viewKey="property_profile">
        <PropertyDetailPage />
      </RequireView>
    ),
  },
];

export const router = createBrowserRouter(
  [
    {
      element: <GatedLayout />,
      children: [
        { index: true, element: <DashboardPage /> },
        ...propertyRoutes,
        ...placeholderRoutes,
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ],
  { basename: '/app' },
);
