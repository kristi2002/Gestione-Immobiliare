import { lazy, type ReactElement } from 'react';
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
const ClientsPage = lazy(() => import('@/features/clients/ClientsPage'));
const LeadsPage = lazy(() => import('@/features/leads/LeadsPage'));
const LeadFormPage = lazy(() => import('@/features/leads/LeadFormPage'));
const TenantsPage = lazy(() => import('@/features/tenants/TenantsPage'));
const AgentsPage = lazy(() => import('@/features/agents/AgentsPage'));
const ContractsPage = lazy(() => import('@/features/contracts/ContractsPage'));
const PaymentsPage = lazy(() => import('@/features/payments/PaymentsPage'));
const InvoicesPage = lazy(() => import('@/features/invoices/InvoicesPage'));
const CommissionsPage = lazy(() => import('@/features/commissions/CommissionsPage'));
const KeysPage = lazy(() => import('@/features/keys/KeysPage'));
const MetersPage = lazy(() => import('@/features/meters/MetersPage'));
const InventoryPage = lazy(() => import('@/features/inventory/InventoryPage'));
const InsurancePage = lazy(() => import('@/features/insurance/InsurancePage'));
const SuppliersPage = lazy(() => import('@/features/suppliers/SuppliersPage'));
const ApplicationsPage = lazy(() => import('@/features/applications/ApplicationsPage'));
const AppointmentsPage = lazy(() => import('@/features/appointments/AppointmentsPage'));
const SurveysPage = lazy(() => import('@/features/surveys/SurveysPage'));
const ActivityLogPage = lazy(() => import('@/features/activity/ActivityLogPage'));
const BuildingsPage = lazy(() => import('@/features/buildings/BuildingsPage'));
const ExpensesPage = lazy(() => import('@/features/expenses/ExpensesPage'));
const DocumentsPage = lazy(() => import('@/features/documents/DocumentsPage'));
const RemindersPage = lazy(() => import('@/features/reminders/RemindersPage'));
const ValuationPage = lazy(() => import('@/features/valuation/ValuationPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const ForecastPage = lazy(() => import('@/features/forecast/ForecastPage'));
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'));
const CalendarPage = lazy(() => import('@/features/calendar/CalendarPage'));
const MapPage = lazy(() => import('@/features/map/MapPage'));
const PortalsPage = lazy(() => import('@/features/portals/PortalsPage'));
const ScadenzarioPage = lazy(() => import('@/features/scadenzario/ScadenzarioPage'));
const MaintenancePage = lazy(() => import('@/features/maintenance/MaintenancePage'));
const AmlPage = lazy(() => import('@/features/aml/AmlPage'));
const CommunicationsPage = lazy(() => import('@/features/communications/CommunicationsPage'));
const WhatsappInboxPage = lazy(() => import('@/features/whatsapp/WhatsappInboxPage'));
const SocialPage = lazy(() => import('@/features/social/SocialPage'));
const AutomationsPage = lazy(() => import('@/features/automations/AutomationsPage'));
const PlaceholderPage = lazy(() => import('@/pages/PlaceholderPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));
const LoginPage = lazy(() => import('@/features/auth/LoginPage'));
const Login2FAPage = lazy(() => import('@/features/auth/Login2FAPage'));

/** view key → real page element. Keys in this map become real routes; every
 * other nav item falls through to the placeholder. */
const FEATURE_PAGES: Record<string, ReactElement> = {
  clients: <ClientsPage />,
  leads: <LeadsPage />,
  tenants: <TenantsPage />,
  agents: <AgentsPage />,
  contracts: <ContractsPage />,
  payments: <PaymentsPage />,
  invoices: <InvoicesPage />,
  commissions: <CommissionsPage />,
  keys: <KeysPage />,
  meters: <MetersPage />,
  inventory: <InventoryPage />,
  insurance: <InsurancePage />,
  suppliers: <SuppliersPage />,
  property_applications: <ApplicationsPage />,
  appointments: <AppointmentsPage />,
  surveys: <SurveysPage />,
  activity_log: <ActivityLogPage />,
  buildings: <BuildingsPage />,
  expenses: <ExpensesPage />,
  documents: <DocumentsPage />,
  reminders: <RemindersPage />,
  valuation: <ValuationPage />,
  settings: <SettingsPage />,
  forecast: <ForecastPage />,
  reports: <ReportsPage />,
  calendar: <CalendarPage />,
  map: <MapPage />,
  portal_sync: <PortalsPage />,
  scadenzario: <ScadenzarioPage />,
  maintenance_workflow: <MaintenancePage />,
  aml: <AmlPage />,
  communications: <CommunicationsPage />,
  whatsapp_inbox: <WhatsappInboxPage />,
  social: <SocialPage />,
  automations: <AutomationsPage />,
};

/** View keys handled by real React pages (skip the placeholder generator). */
const IMPLEMENTED = new Set<string>(['dashboard', 'properties', ...Object.keys(FEATURE_PAGES)]);

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

// People pages (Proprietari, Leads, Inquilini, Agenti) — paths from the nav config.
const peopleRoutes: RouteObject[] = ALL_NAV_ITEMS.filter((item) => item.key in FEATURE_PAGES).map((item) => ({
  path: item.path.replace(/^\//, ''),
  element: <RequireView viewKey={item.key}>{FEATURE_PAGES[item.key]}</RequireView>,
}));

// Lead create/edit — gated by "lead_edit", the backend's own distinct
// permission key for this action (separate from "leads", the list view).
const leadFormRoutes: RouteObject[] = [
  {
    path: 'leads/new',
    element: (
      <RequireView viewKey="lead_edit">
        <LeadFormPage />
      </RequireView>
    ),
  },
  {
    path: 'leads/:id/edit',
    element: (
      <RequireView viewKey="lead_edit">
        <LeadFormPage />
      </RequireView>
    ),
  },
];

export const router = createBrowserRouter([
  // Public routes — must render outside GatedLayout/AuthProvider, since the
  // user has no session yet when reaching them.
  { path: 'login', element: <LoginPage /> },
  { path: 'login/2fa', element: <Login2FAPage /> },
  {
    element: <GatedLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      ...propertyRoutes,
      ...leadFormRoutes,
      ...peopleRoutes,
      ...placeholderRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
