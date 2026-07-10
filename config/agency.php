<?php
/**
 * Agency scoping (multi-tenant scaffold).
 *
 * The platform runs single-agency today: every row carries agency_id = 1 (see
 * migration phase31). These helpers centralise the "which agency is this request
 * for" decision so a future multi-agency rollout only has to (a) resolve the
 * agency from the session/host here and (b) apply scopeToAgency() in queries —
 * instead of touching every endpoint.
 *
 * Nothing calls scopeToAgency() in WHERE clauses yet; it is provided so the
 * pattern exists and is testable.
 */

const DEFAULT_AGENCY_ID = 1;

/**
 * The agency the current request belongs to. Today this is always the single
 * active agency. In a multi-agency future, resolve it from the admin session
 * (e.g. $_SESSION['agency_id']) or the request host and return that instead.
 */
function currentAgencyId(): int
{
    $sessionAgency = isset($_SESSION['agency_id']) ? (int) $_SESSION['agency_id'] : 0;
    return $sessionAgency > 0 ? $sessionAgency : DEFAULT_AGENCY_ID;
}

/**
 * Append an agency predicate to a WHERE clause and bind the parameter.
 *
 * Example (future use):
 *   [$where, $params] = scopeToAgency('WHERE status = :s', ['s' => 'available'], 'p');
 *   // -> "WHERE status = :s AND p.agency_id = :__agency_id"
 *
 * @param  string $where      Existing clause beginning with WHERE (or empty).
 * @param  array  $params     Existing bound params (mutated copy returned).
 * @param  string $alias      Optional table alias for the agency_id column.
 * @return array{0:string,1:array}
 */
function scopeToAgency(string $where, array $params = [], string $alias = ''): array
{
    $col   = ($alias !== '' ? $alias . '.' : '') . 'agency_id';
    $pred  = $col . ' = :__agency_id';
    $where = trim($where) === ''
        ? 'WHERE ' . $pred
        : $where . ' AND ' . $pred;

    $params['__agency_id'] = currentAgencyId();
    return [$where, $params];
}
