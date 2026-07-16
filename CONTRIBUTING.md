# Contributing — two-person workflow (frontend / backend)

This repo is worked on by two people in parallel. **Every push to `main`
auto-deploys to production** (Coolify builds one image per commit SHA, live in
~1–2 min). Treat `main` as production. The rules below exist so we never
clobber each other's work or ship a half-broken state.

## 1. Ownership map — who owns which folders

Conflicts in git happen at the **file** level, not the folder level, but we
almost never touch the same files because the work splits cleanly by directory.

| Area | Owner | Paths |
|------|-------|-------|
| **Frontend** | Juliano | `frontend/` (React SPA), `web-orlandi/` (public site), `views/` + `assets/` (legacy admin UI), `immobiliare design/` (mockups, gitignored) |
| **Backend** | Kapo | `api/`, `config/`, `lib/`, `cron/`, `database/`, `scripts/`, `tests/`, `docker/`, and the root PHP entry points (`index.php`, `login*.php`, `apply.php`, `sign.php`, etc.) |

**Shared / coordinate before editing:** `api/*.php` files the frontend calls
by URL, `.htaccess`, `Dockerfile`, `docker-compose.yml`, `.env.example`,
`composer.json`, this file, and `README.md`. Ping the other person before
renaming or moving anything in these.

> Backend files can't be freely reorganized: each `api/*.php` is a **public URL**
> the frontend calls (`/api/invoices.php`), and every backend file includes
> config via `__DIR__ . '/../config/...'`. Renaming or nesting these breaks both
> the frontend and the include graph. So the layout is intentionally flat and
> pinned — don't "tidy" it without coordinating.

## 2. The golden rule for pushing

**Always sync before you push. Never force-push `main`.**

```bash
git pull --rebase origin main   # replay your work on top of theirs
# resolve conflicts if any (usually none — different folders)
git push origin main
```

Set rebase-on-pull once so you can't forget:

```bash
git config pull.rebase true
```

Why rebase, not merge: it keeps history linear and avoids a "merge bubble" on
every sync. Because we edit different folders, `pull --rebase` almost always
replays cleanly with zero conflicts.

## 3. Bigger or riskier changes → use a branch

For anything beyond a small edit — a refactor, a folder reorg, a schema change,
or anything that touches a **shared** file from §1 — don't commit straight to
`main`:

```bash
git checkout -b backend/<short-topic>     # or frontend/<short-topic>
# ... work, commit ...
git push -u origin backend/<short-topic>
```

Then verify (§4), fast-forward `main`, and push:

```bash
git checkout main && git pull --rebase origin main
git merge --ff-only backend/<short-topic>
git push origin main
git branch -d backend/<short-topic>
```

This keeps every intermediate (possibly broken) commit **off** production —
only the verified end state lands on `main` and deploys.

## 4. Verify before `main` (because `main` = prod)

Minimum gate before a backend change hits `main`:

```bash
# lint every backend PHP file — must print 0 errors
find . -name '*.php' -not -path './vendor/*' -not -path './frontend/*' \
  -exec php -l {} \; | grep -v 'No syntax errors'
```

For anything touching auth, money, documents, or DB, also run the relevant
checks in `CLAUDE.md` (the verification protocol). "It lints" is not "it works."

## 5. Database changes are append-only

Never edit an existing `database/migrations/phaseNN_*.sql` that has already been
deployed — it's already applied in prod (`migrate.php` runs on every container
start and records applied files in `schema_migrations`). Add a **new**
`phaseNN+1_*.sql` instead. `schema_production.sql` is the source of truth; the
legacy `schema.sql` is Phase-1 dev-only and should not be used.

## 6. Commit messages

Short imperative subject, prefix with area: `api:`, `db:`, `cron:`, `frontend:`,
`web:`, `docker:`. Example: `api: fix duplicate rows in generate_payments`.
