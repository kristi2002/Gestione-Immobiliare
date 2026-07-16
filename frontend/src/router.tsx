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
const BuildingFormPage = lazy(() => import('@/features/buildings/BuildingFormPage'));
const KeyFormPage = lazy(() => import('@/features/keys/KeyFormPage'));
const MeterFormPage = lazy(() => import('@/features/meters/MeterFormPage'));
const InventoryFormPage = lazy(() => import('@/features/inventory/InventoryFormPage'));
const SupplierFormPage = lazy(() => import('@/features/suppliers/SupplierFormPage'));
const DocumentFormPage = lazy(() => import('@/features/documents/DocumentFormPage'));
const InsuranceFormPage = lazy(() => import('@/features/insurance/InsuranceFormPage'));
const ReminderFormPage = lazy(() => import('@/features/reminders/ReminderFormPage'));
const CommissionFormPage = lazy(() => import('@/features/commissions/CommissionFormPage'));
const ExpenseFormPage = lazy(() => import('@/features/expenses/ExpenseFormPage'));
const AppointmentFormPage = lazy(() => import('@/features/appointments/AppointmentFormPage'));
const ClientFormPage = lazy(() => import('@/features/clients/ClientFormPage'));
const TenantFormPage = lazy(() => import('@/features/tenants/TenantFormPage'));
const InvoiceFormPage = lazy(() => import('@/features/invoices/InvoiceFormPage'));
const PaymentFormPage = lazy(() => import('@/features/payments/PaymentFormPage'));
const ContractFormPage = lazy(() => import('@/features/contracts/ContractFormPage'));
const PropertyFormPage = lazy(() => import('@/features/properties/PropertyFormPage'));
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

// Create/edit routes for every entity whose "Nuovo X"/"Modifica" used to
// bounce out to the legacy PHP admin (/index.php?view=X_edit). viewKey is
// the backend's own permission key for the action — a handful of entities
// (lead_edit, property_edit, contract_edit, payment_edit, expense_edit,
// invoice_edit, appointment_edit, tenant_edit, client_edit) have a distinct
// edit permission separate from their list-view key; the rest share one key
// for both (matching how the legacy PHP itself gates them — a single modal
// on the list view, not a separate page/permission).
// Maintenance and Valuation are deliberately excluded: neither has a real
// create/edit contract to port (see the react-cutover branch notes) —
// Maintenance's "Nuova Richiesta" was already a dead link to a legacy view
// that doesn't exist, and Valuation's list is wired to an unrelated,
// mismatched backend (property_appraisals.php vs. the real valuation.php
// OMI-quotations feature) that needs a product decision before any form is
// built against it.
const ENTITY_FORMS: { path: string; viewKey: string; element: ReactElement; noEdit?: boolean }[] = [
  { path: 'leads', viewKey: 'lead_edit', element: <LeadFormPage /> },
  { path: 'properties', viewKey: 'property_edit', element: <PropertyFormPage /> },
  { path: 'buildings', viewKey: 'buildings', element: <BuildingFormPage /> },
  { path: 'keys', viewKey: 'keys', element: <KeyFormPage /> },
  { path: 'meters', viewKey: 'meters', element: <MeterFormPage /> },
  { path: 'inventory', viewKey: 'inventory', element: <InventoryFormPage /> },
  { path: 'suppliers', viewKey: 'suppliers', element: <SupplierFormPage /> },
  { path: 'documents', viewKey: 'documents', element: <DocumentFormPage />, noEdit: true },
  { path: 'insurance', viewKey: 'insurance', element: <InsuranceFormPage /> },
  { path: 'reminders', viewKey: 'reminders', element: <ReminderFormPage /> },
  { path: 'commissions', viewKey: 'commissions', element: <CommissionFormPage /> },
  { path: 'expenses', viewKey: 'expense_edit', element: <ExpenseFormPage /> },
  { path: 'appointments', viewKey: 'appointment_edit', element: <AppointmentFormPage /> },
  { path: 'clients', viewKey: 'client_edit', element: <ClientFormPage /> },
  { path: 'tenants', viewKey: 'tenant_edit', element: <TenantFormPage /> },
  { path: 'invoices', viewKey: 'invoice_edit', element: <InvoiceFormPage /> },
  { path: 'payments', viewKey: 'payment_edit', element: <PaymentFormPage /> },
  { path: 'contracts', viewKey: 'contract_edit', element: <ContractFormPage /> },
];

const entityFormRoutes: RouteObject[] = ENTITY_FORMS.flatMap(({ path, viewKey, element, noEdit }) => [
  { path: `${path}/new`, element: <RequireView viewKey={viewKey}>{element}</RequireView> },
  ...(noEdit ? [] : [{ path: `${path}/:id/edit`, element: <RequireView viewKey={viewKey}>{element}</RequireView> }]),
]);

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
      ...entityFormRoutes,
      ...peopleRoutes,
      ...placeholderRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
