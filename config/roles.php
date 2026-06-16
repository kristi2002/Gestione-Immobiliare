<?php
/**
 * Role-based access control.
 */

const ADMIN_ROLES = ['super_admin', 'admin', 'agent', 'readonly'];

const ROLE_PERMISSIONS = [
    'super_admin' => ['*'],
    'admin'       => ['dashboard','clients','leads','properties','contracts','documents','payments','expenses','invoices','communications','appointments','calendar','map','reminders','tenants','keys','agents','reports','social','settings','pdf'],
    'agent'       => ['dashboard','clients','leads','properties','contracts','documents','payments','expenses','communications','appointments','calendar','map','reminders','tenants','keys','pdf'],
    'readonly'    => ['dashboard','clients','leads','properties','contracts','documents','payments','expenses','communications','appointments','calendar','map','reminders','tenants'],
];

const VIEW_MIN_ROLE = [
    'settings'     => 'super_admin',
    'users'        => 'super_admin',
    'activity_log' => 'super_admin',
    'reports'      => 'admin',
    'agents'       => 'admin',
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
