<?php
/**
 * Role-based access control.
 */

const ADMIN_ROLES = ['super_admin', 'admin', 'agent', 'readonly'];

const ROLE_PERMISSIONS = [
    'super_admin' => ['*'],
    'admin'       => ['dashboard','clients','client_profile','client_edit','leads','lead_edit','properties','property_profile','property_edit','contracts','contract_edit','documents','payments','payment_edit','expenses','expense_edit','invoices','invoice_edit','communications','appointments','appointment_edit','appointment_profile','calendar','map','reminders','automations','tenants','tenant_edit','tenant_profile','keys','agents','reports','social','pdf','buildings','building_profile','insurance','meters','suppliers','inventory','commissions','surveys','forecast','maintenance_workflow','whatsapp_inbox','property_applications','aml','scadenzario','portal_sync','valuation'],
    'agent'       => ['dashboard','clients','client_profile','client_edit','leads','lead_edit','properties','property_profile','property_edit','contracts','contract_edit','documents','payments','payment_edit','expenses','expense_edit','communications','appointments','appointment_edit','appointment_profile','calendar','map','reminders','automations','tenants','tenant_edit','tenant_profile','keys','pdf','buildings','building_profile','insurance','meters','suppliers','inventory','surveys','maintenance_workflow','whatsapp_inbox','property_applications','aml','scadenzario','portal_sync','valuation'],
    'readonly'    => ['dashboard','clients','client_profile','client_edit','leads','lead_edit','properties','property_profile','property_edit','contracts','contract_edit','documents','payments','payment_edit','expenses','expense_edit','communications','appointments','appointment_edit','appointment_profile','calendar','map','reminders','tenants','tenant_edit','tenant_profile','buildings','building_profile','insurance','meters','suppliers','inventory','surveys','forecast','property_applications','invoices','invoice_edit','aml','scadenzario','portal_sync','valuation'],
];

// Features present in code but intentionally turned off — no working backend
// behind them yet. Blocked unconditionally for every role until re-enabled here.
// (portal_sync lives here no longer: it is a manual publish-state tracker, which
// works standalone; the automatic feed push to each portal stays out of scope.)
const DISABLED_VIEWS = [];

function isViewDisabled(string $view): bool
{
    return in_array($view, DISABLED_VIEWS, true);
}

/**
 * Schema-driven form pages all share one route (view.php?name=entity_edit with
 * an `entity` parameter), so the role check can't key off the view name alone:
 * it has to resolve to the list view that owns the entity. Keep this in sync
 * with the REGISTRY in assets/js/entity_edit/schemas/index.js — an entity
 * missing here is refused for every role, which is the safe direction.
 */
const ENTITY_FORM_VIEWS = [
    'suppliers'    => 'suppliers',
    'insurance'    => 'insurance',
    'commissions'  => 'commissions',
    'keys'         => 'keys',
    'buildings'    => 'buildings',
    'aml'          => 'aml',
    'valuation'    => 'valuation',
    'applications' => 'property_applications',
];

function entityFormListView(string $entity): ?string
{
    return ENTITY_FORM_VIEWS[$entity] ?? null;
}

// Attenzione: VIEW_MIN_ROLE vince su ROLE_PERMISSIONS. Elencare una vista qui
// e anche là (com'era per 'settings' nel ruolo admin) crea una riga morta che
// racconta un permesso che non esiste: la soglia qui sotto è l'unica vera.
const VIEW_MIN_ROLE = [
    // Il proprio account lo gestisce chiunque abbia un accesso, sola lettura
    // compresa: è dove si attiva la 2FA, e negarla a un ruolo significherebbe
    // lasciare quel ruolo senza secondo fattore.
    'account'      => 'readonly',
    'settings'     => 'super_admin',
    'users'        => 'super_admin',
    'activity_log' => 'super_admin',
    'reports'      => 'admin',
    'agents'       => 'admin',
    // La scheda si apre dal Portafoglio: stessa soglia della lista, e stessa
    // soglia di api/agent_portfolio.php. Senza questa riga cadeva su
    // ROLE_PERMISSIONS, dove non compare per nessun ruolo: 403 anche per admin.
    'agent_profile' => 'admin',
    'invoices'     => 'admin',
];

function getCurrentRole(): string
{
    return $_SESSION['admin_role'] ?? 'readonly';
}

function roleLevel(string $role): int
{
    return match ($role) {
        'super_admin' => 4,
        'admin'       => 3,
        'agent'       => 2,
        'readonly'    => 1,
        default       => 0,
    };
}

function hasRole(string ...$roles): bool
{
    return in_array(getCurrentRole(), $roles, true);
}

function canAccessView(string $view): bool
{
    $role = getCurrentRole();

    if (isset(VIEW_MIN_ROLE[$view])) {
        return roleLevel($role) >= roleLevel(VIEW_MIN_ROLE[$view]);
    }

    $allowed = ROLE_PERMISSIONS[$role] ?? [];
    return in_array('*', $allowed, true) || in_array($view, $allowed, true);
}

function requireRole(string ...$roles): void
{
    if (!hasRole(...$roles)) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success' => false, 'error' => 'Permesso negato.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

function requireViewAccess(string $view): void
{
    if (!canAccessView($view)) {
        http_response_code(403);
        exit('Accesso negato.');
    }
}

function isReadOnlyRole(): bool
{
    return getCurrentRole() === 'readonly';
}

function requireWriteAccess(): void
{
    if (isReadOnlyRole()) {
        if (PHP_SAPI !== 'cli' && !headers_sent()) {
            apiHeaders();
        }
        apiError('Account in sola lettura.', 403);
    }
}
