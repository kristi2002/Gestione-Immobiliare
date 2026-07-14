# Immobiliare Orlandi — React Frontend

React 19 + Vite + TypeScript SPA that consumes the existing PHP JSON API.
Built as a **strangler migration**: this app is served under `/app`, the legacy
PHP SPA keeps living at `/` until each screen is ported.

## Stack

| Concern      | Choice                                             |
|--------------|----------------------------------------------------|
| Build        | Vite 6                                             |
| UI           | Tailwind CSS 3 + shadcn/ui-style primitives        |
| Icons        | lucide-react                                       |
| Data         | @tanstack/react-query (server state)               |
| Routing      | react-router-dom v7                                |
| Charts       | recharts                                           |
| Auth         | existing PHP session cookie (`gestionale_session`) + CSRF header |

## Running locally

1. **Start the PHP backend** (from the repo root) so the API + login exist:
   ```bash
   php -S localhost:8000 -t .
   ```
   (or use the project's `avvia.ps1`). MySQL must be running.

2. **Start the frontend dev server** (from `frontend/`):
   ```bash
   npm install
   npm run dev
   ```
   Vite proxies `/api`, `/uploads`, `/assets`, `/login.php`, `/logout.php` to the
   PHP backend (see `VITE_API_PROXY` in `.env.development`), so the browser treats
   everything as same-origin and the session cookie flows normally.

3. Open **http://localhost:5173/app/**. If not logged in you'll be redirected to
   the PHP login; after logging in, return to `/app/`.

## Scripts

- `npm run dev` — dev server with HMR
- `npm run build` — typecheck (`tsc -b`) + production build to `dist/`
- `npm run typecheck` — types only
- `npm run preview` — serve the production build

## Architecture

```
src/
  lib/
    api/         client.ts (fetch + CSRF + envelope), queryClient.ts
    utils.ts     cn()
    format.ts    it-IT currency / date / number helpers
  types/         shared API + domain types
  config/        navigation.ts (role-gated sidebar model)
  components/
    ui/          shadcn-style primitives (button, card, badge, avatar, …)
    common/      KpiCard, DataTable, StatusBadge, EmptyState, ErrorState, PageHeader
    layout/      AppLayout, Sidebar, SidebarNav, Topbar
  features/
    auth/        AuthProvider, useAuth, RequireView, /api/me hook
    dashboard/   DashboardPage + api + components (KPIs, RevenueChart, …)
  pages/         PlaceholderPage, NotFoundPage
  router.tsx     routes generated from the nav config, permission-guarded
```

### Conventions

- **Feature-first**: each domain lives under `features/<name>/` with its own
  `api.ts`, `components/`, and page. Cross-cutting UI is in `components/`.
- **No inline styles** — Tailwind utilities + the tokens in `tailwind.config.ts`
  (`bg-primary`, `text-navy`, `shadow-card`, …).
- **Every list/table** ships loading skeletons + empty states.
- **All UI copy is Italian.**

## Design tokens (`tailwind.config.ts`)

`primary #0B3D91` · `sidebar/navy #06224F` · `secondary #4A90D9` ·
`background #EEF2F8` · `success #22C55E` · `warning #F97316` · `danger #EF4444`
