/**
 * Clients (Proprietari) — pure HTML-string builders. Stateless.
 *
 * NOTE: the legacy controller built all of its markup inline, inside functions
 * that also read/write the page DOM by id (renderCards, openRail, the modal
 * loaders, etc.). None of that HTML lives in a standalone data-in → string-out
 * builder, so — per the conservative extraction rule — nothing was pulled out
 * here. All template building remains in index.js. This module is intentionally
 * export-free.
 */
