# Uploads security posture — verified

> Scope: how uploaded files are protected, what is public by design, and the
> defense-in-depth added July 2026. Written to the CLAUDE.md §0 standard — every
> claim below is either statically auditable in this repo or was executed; the one
> check that needs a live server is called out explicitly under "Could NOT verify".

---

## The two trees

| Tree | Contents | Direct URL access | Served by |
|---|---|---|---|
| `uploads/properties/…` | Listing **images/video/floor-plans** — marketing material | **Public** (by design: website, portals, social, Meta fetch) | Apache directly, or `api/media.php` for public types |
| `uploads/documents/…` | **ID scans, contracts, generated PDFs/invoices, private attachments** | **Denied — always** | `api/download_document.php`, `api/download_pdf.php`, `api/media.php` (attachments) — PHP `readfile()` only |

`uploads/documents/property_attachments/` (private property attachments) lives in the
denied tree and is reachable only through `api/media.php` with ownership scoping.

---

## Layers of protection (defense in depth)

1. **Per-folder deny** — `uploads/documents/.htaccess` = `Require all denied`. Subdirectories
   (`2026/`, `generated/`, `property_attachments/`) inherit it. `uploads/.htaccess` denies script
   execution and directory listing; `uploads/properties/.htaccess` denies office/archive file types.
2. **Root belt-and-suspenders** (added July 2026, `/.htaccess`) — duplicates the deny for
   `^uploads/documents/` and for document extensions anywhere under `uploads/`, so protection
   **survives even if a nested `.htaccess` is lost** during a deploy/rsync.
3. **Authorization gate** — the three PHP streamers enforce per-identity scoping in the SQL WHERE
   clause; a caller who may not see a file gets **404** (no existence oracle):
   - Admin → any file. Tenant → only their current-contract property's files (+ that property's
     owner's docs). Owner → only their own client docs / owned-property files.
4. **Path-containment guard** (added July 2026, `config/upload_guard.php`) — `safeUploadRealPath()`
   `realpath()`-resolves the DB-stored path and refuses to serve anything that does not resolve to a
   regular file **inside** `uploads/`. This makes traversal (`../../config/db.php`) and NUL-byte
   injection impossible **regardless of web-server or `.htaccess` config**. Wired into all three
   streamers.
5. **GDPR access log** — every document download is recorded (`config/gdpr.php`) with actor + target.

---

## Why the deployment honors `.htaccess`

`Dockerfile` builds on `php:8.3-apache-bookworm` and sets `AllowOverride All` on the docroot, so the
`Require all denied` / `RewriteRule … [F,L]` directives above are active on the real server. (On a
web server that ignores `.htaccess`, layers 3–4 still hold — the authorization gate and the
containment guard are pure PHP.)

---

## Evidence

- **Path guard — executed** (`php` CLI, July 2026): 7/7 cases pass — valid uploads file served;
  `../../config/db.php`, `../config/db.php`, `config/db.php`, nonexistent, empty, and NUL-byte paths
  all **blocked**.
- **Authorization logic — statically audited**: `api/download_document.php` and `api/media.php`
  scope by tenant contract / owner `client_id` in SQL; unauthorized ⇒ 404. `api/download_pdf.php` is
  admin-only.
- **No leaks**: no client-facing code or API emits raw `uploads/documents/…` URLs — documents are
  always linked via `api/download_document.php?id=` (the API returns `download_url`, never `file_path`).

## Live-verified (2026-07-12, Docker cold-start stack)

The end-to-end checks from CLAUDE.md §4.5 / §4.3 were run against a fresh `php:8.3-apache` + MySQL 8
stack (`docker compose`), admin created via `setup.php`:

| Check | Result |
|---|---|
| `GET /uploads/documents/fatture/IT…_00006.xml` (real persisted invoice XML, no path via app) | **403** ✓ |
| `GET /api/download_document.php?id=1` with **no cookie** | **401** ✓ |
| `GET /api/media.php?id=999999` (guard, bogus id) | **404** (not 500) ✓ |
| `GET /config/db.php` | **403** ✓ |
| `GET /views/dashboard.html` | **403** ✓ |
| `GET /api/get_dashboard_stats.php` no cookie / with cookie | **401 / 200** ✓ |
| `GET /setup.php` after lock written | **403** ✓ |
| `POST /api/clients.php` without CSRF token | **403** "Token CSRF non valido" ✓ |

The `Require all denied` on `uploads/documents/` (and its `fatture/` subdir) is confirmed honored by the
real Apache deployment. Nothing left owed for the uploads boundary.
