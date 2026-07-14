import {
  LayoutDashboard, Users, Target, KeyRound, UserRound, Building2, Building, Map,
  Key, Gauge, Package, Globe2, Calculator, ScrollText, FileText, Receipt,
  Banknote, Wallet, Briefcase, TrendingUp, BarChart3, CalendarClock, Wrench,
  ShieldCheck, Truck, ClipboardList, ShieldAlert, Mail, MessageCircle, Megaphone,
  Star, CalendarCheck, Calendar, Bell, Workflow, History, Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  /** Matches the backend view key used for role permissions (config/roles.php). */
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
}

export interface NavGroup {
  /** Section eyebrow shown above the group (null = no header, e.g. Panoramica). */
  title: string | null;
  items: NavItem[];
}

/** Route path for a view key ("dashboard" is the index route). */
const pathFor = (key: string) => (key === 'dashboard' ? '/' : `/${key}`);

const item = (key: string, label: string, icon: LucideIcon): NavItem => ({
  key,
  label,
  icon,
  path: pathFor(key),
});

export const NAV_GROUPS: NavGroup[] = [
  {
    title: null,
    items: [item('dashboard', 'Dashboard', LayoutDashboard)],
  },
  {
    title: 'Anagrafiche',
    items: [
      item('clients', 'Proprietari', Users),
      item('leads', 'Leads', Target),
      item('tenants', 'Inquilini', KeyRound),
      item('agents', 'Portafoglio agenti', UserRound),
    ],
  },
  {
    title: 'Immobili',
    items: [
      item('properties', 'Immobili', Building2),
      item('buildings', 'Edifici', Building),
      item('map', 'Mappa', Map),
      item('keys', 'Chiavi', Key),
      item('meters', 'Contatori', Gauge),
      item('inventory', 'Inventario', Package),
      item('portal_sync', 'Pubblicazioni portali', Globe2),
      item('valuation', 'Valutazioni OMI', Calculator),
    ],
  },
  {
    title: 'Contratti & Finanza',
    items: [
      item('contracts', 'Contratti', ScrollText),
      item('documents', 'Documenti', FileText),
      item('invoices', 'Fatture', Receipt),
      item('payments', 'Pagamenti', Banknote),
      item('expenses', 'Spese', Wallet),
      item('commissions', 'Provvigioni', Briefcase),
      item('forecast', 'Previsioni', TrendingUp),
      item('reports', 'Report', BarChart3),
      item('scadenzario', 'Scadenzario fiscale', CalendarClock),
    ],
  },
  {
    title: 'Operatività',
    items: [
      item('maintenance_workflow', 'Manutenzione', Wrench),
      item('insurance', 'Assicurazioni', ShieldCheck),
      item('suppliers', 'Fornitori', Truck),
      item('property_applications', 'Richieste', ClipboardList),
      item('aml', 'Antiriciclaggio', ShieldAlert),
    ],
  },
  {
    title: 'Comunicazione',
    items: [
      item('communications', 'Comunicazioni', Mail),
      item('whatsapp_inbox', 'WhatsApp Inbox', MessageCircle),
      item('social', 'Social Media', Megaphone),
      item('surveys', 'Sondaggi', Star),
    ],
  },
  {
    title: 'Agenda',
    items: [
      item('appointments', 'Visite', CalendarCheck),
      item('calendar', 'Calendario', Calendar),
      item('reminders', 'Promemoria', Bell),
      item('automations', 'Automazioni', Workflow),
    ],
  },
  {
    title: 'Sistema',
    items: [
      item('activity_log', 'Log Attività', History),
      item('settings', 'Impostazioni', Settings),
    ],
  },
];

/** Flat list of every routable nav item (used to generate routes). */
export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
