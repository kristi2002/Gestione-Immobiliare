# Future Architecture — reference for a possible v2 (multi-agency SaaS)

> **Status: PARKED — not adopted.** The live product is and stays PHP 8.3 + MySQL 8 + vanilla-JS SPA,
> deployed on Hetzner for a single agency (Orlandi). This document captures a proposed "modern proptech
> SaaS" stack so the ideas aren't lost, and records **which parts are worth stealing incrementally now**
> vs. which only make sense if/when the product becomes a multi-agency SaaS. Do **not** treat this as a
> plan of record — it's a thinking tool for later.

Written: July 2026, after an architecture discussion. See also `docs/DEPLOYMENT_PLAN.md` (current plan).

---

## The proposed stack (as pitched)

| Layer | Proposal |
|---|---|
| Frontend | **Next.js** (SSR) + **Tailwind CSS** + **Zustand/Redux** |
| Backend | **NestJS** (Node) *or* **FastAPI** (Python) |
| Async | **RabbitMQ** or **Redis/BullMQ** message broker for background jobs |
| Primary DB | **PostgreSQL** (strict relational integrity) |
| Search | **Elasticsearch** (geospatial + faceted "incroci automatici") |
| Media | **AWS S3** object storage |
| Infra | **Docker + Kubernetes** on AWS/GCP, autoscaling |
| Mobile | **React Native / Flutter** (one codebase, iOS+Android) |

It is a legitimate, well-known reference architecture. The caveat is **fit and stage**: it's designed for
*many* agencies, thousands of concurrent agents, and 50k+ listings with a dev team to operate it — not for
one agency on a VPS. Adopting it now would mean pausing the product to rewrite it.

---

## Assessment vs. the current product

| Component | Verdict | Why |
|---|---|---|
| Next.js + Tailwind + Zustand | Nice DX, **not a rewrite trigger** | List speed comes from pagination + indexes + lazy images (framework-agnostic), which the SPA already does. |
| NestJS / FastAPI | Fine greenfield choice | FastAPI's "AI advantage" is a myth — AI is an HTTP call from any language (already done in PHP: `lib/ai.php`). |
| **Message broker (queue)** | **The best idea — steal the concept now** | Portal publishing is slow/rate-limited/failure-prone → belongs in a retryable background job. But a **DB-backed job queue on the existing cron** covers one agency; RabbitMQ/K8s is overkill. |
| PostgreSQL | Both fine; **don't migrate** | MySQL 8 is capable at this scale. Migration = pure risk, no user-visible payoff. |
| Elasticsearch | **Most over-sold; skip for now** | 50k rows with geo + facets is milliseconds in MySQL 8 spatial indexes / Postgres+PostGIS. ES is another stateful service to sync. Revisit only when measured need appears. |
| **S3 object storage** | **Directionally right — adopt incrementally** | Don't store blobs in the DB (already true — files on disk under `uploads/`). Move media + backups to S3-compatible storage (Hetzner Object Storage / Backblaze B2). Keep serving sensitive docs via the auth streamer (`docs/UPLOADS_SECURITY.md`). |
| Docker | Yes (already have a `Dockerfile`) | — |
| **Kubernetes** | **Clear over-engineering now** | Autoscaling for load one small VPS handles is a non-problem; operating a cluster costs more than it saves. |
| React Native / Flutter | Real value, but **later** | A hardened **PWA** (already shipped: `manifest.json`, `sw.js`) covers most field use (photo upload on a viewing). Native only if the PWA proves insufficient — matches roadmap 4.4. |

---

## What to actually steal — incrementally, on the current stack

1. **DB-backed job queue** — a `jobs` table + a cron worker with retry/backoff, for portal pushes, email,
   and heavy PDF/XML. Gives the "don't freeze the UI, retry on failure" benefit without a broker. Ties into
   the existing `portal_listings` status model.
2. **S3-compatible object storage** for media + backups (S3 backup config is already half-wired in Settings).
3. **PWA hardening** before any native app.
4. **Spatial search in MySQL first** (generated columns + `SPATIAL` index); reach for Elasticsearch only
   when a real measurement shows MySQL can't keep up.

## What's genuinely v2-only (multi-agency SaaS)

- Elasticsearch, Kubernetes/autoscaling, message broker cluster, and a service-oriented backend become
  reasonable **once there are many tenants** and a team to run them.
- **Migration posture when that day comes:** strangler-fig, one service at a time behind the existing app —
  **never a big-bang rewrite** — and only **after validating that multiple agencies will buy** the SaaS.
  The DB is already "single-tenant, architected-for-multi", which is the right hedge.

## The strategic point

The proposed stack solves **scale + multi-tenancy + large-team** problems. The current business problems are
**close the Orlandi deal, be *a norma* (fiscal/legal), be secure, make portal publishing actually work
(a credentials/business-terms problem, not an architecture one).** None of those are solved by a rewrite —
so the current stack is an **asset**, and this document stays parked until the multi-agency thesis is proven.
