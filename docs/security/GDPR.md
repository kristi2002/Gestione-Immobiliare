# GDPR & Data Protection — Gestionale Immobiliare

> Working document for the agency (data controller). **Not legal advice** — a
> qualified lawyer/DPO should review and adapt it to the agency's actual
> processing before go-live. It documents what the software provides and the
> procedures it supports.

## 1. Roles

- **Data controller (Titolare):** the agency operating the platform (e.g. Orlandi Immobiliare).
- **Data processors (Responsabili, Art. 28):** infrastructure and service providers (see §5). Each requires a signed DPA.
- **Data subjects (Interessati):** property owners (`clients`), tenants (`tenants`), leads, and the persons named in uploaded documents.

## 2. Records of processing (Art. 30) — summary

| Purpose | Data categories | Legal basis | Retention |
|---------|-----------------|-------------|-----------|
| Mandates, lease/sale contracts, related admin | Identity, contact, contractual, payment, ID documents | Contract (6.1.b) | Fiscal/contractual law (~10y) |
| Fiscal & accounting obligations | Invoices, payments | Legal obligation (6.1.c) | ~10y |
| Operational communications & support | Contact, message content | Legitimate interest / contract | Configurable (default 36 months) |
| WhatsApp messaging | Phone, message content | Consent / contract | Configurable (default 24 months) |
| Marketing (if used) | Contact | Consent (6.1.a), revocable | Until withdrawal |
| Security & audit | IP, access logs | Legitimate interest / legal | 24 months (login attempts 90 days) |

## 3. Technical implementation in the platform

- **Consent ledger:** `consent_records` (subject, purpose, legal basis, granted, exact wording, source, IP, timestamps). Primary consents also mirror onto `clients`/`tenants` (`privacy_consent_at`, `marketing_consent_at`).
- **Data-access audit:** `data_processing_log` records who viewed/exported/downloaded/anonymised whose personal data (populated by `api/download_document.php`, `api/media.php` attachments, and `api/gdpr.php`).
- **Right of access / portability (Art. 15/20):** `GET /api/gdpr.php?action=export&subject_type=&subject_id=` returns the subject's full record + related data (secrets excluded). Recorded in `data_export_requests`.
- **Right to erasure (Art. 17):** `POST /api/gdpr.php?action=erase` records a request; with `confirm=true` it **anonymises** the subject in place (PII overwritten, portal access revoked, consents withdrawn, `anonymized_at` set) so financial/contractual history stays consistent. Recorded in `erasure_requests`.
- **Retention enforcement:** `cron/gdpr_retention.php` purges logs/communications past their configured window. Personal **documents are not auto-deleted** (fiscal law + irreversibility) — they are reported for manual review.
- **Retention configuration:** `app_settings` keys `retention_*` (months/days). Defaults seeded by migration phase32.
- **Access to GDPR tools:** restricted to `super_admin` (the DPO role).
- **Cookie/consent notice:** `assets/js/cookie_consent.js` (functional cookies only); privacy notice at `privacy.php` (Art. 13/14, agency identity from settings).

## 4. Data-subject request procedure (operational)

1. Verify the requester's identity.
2. **Access/portability:** Super-admin runs the export for the subject; deliver the package securely.
3. **Rectification:** edit the record in the admin UI.
4. **Erasure:** create the erasure request; after review, confirm to anonymise. Document the decision (the request row + audit log form the evidence trail).
5. **Consent withdrawal:** record a `granted=0` consent for the purpose (marketing stops; contract/legal bases are unaffected).
6. Respond within **one month** (Art. 12.3).

## 5. Sub-processors (Art. 28) — DPA checklist

Sign a Data Processing Agreement with each provider actually used. Typical set:

| Provider | Role | DPA needed | Notes |
|----------|------|-----------|-------|
| **Hetzner** (hosting) | Infrastructure processor | Yes | EU data centre; AV/DPA available. |
| **Mailgun / SMTP provider** | Email processor | Yes | Inbound/outbound email content. |
| **Twilio** (WhatsApp) | Messaging processor | Yes | Only if WhatsApp is activated. US company — verify SCCs. |
| **Meta** (Facebook/Instagram) | Social publishing | Yes | Only if social publishing is activated. |
| **Stripe** | Payment processor | Yes | Only if payments are activated. |
| **Backup storage (S3-compatible)** | Storage processor | Yes | Only if cloud backup is enabled; prefer EU region. |

Providers that are **not configured are not processing data** — no DPA needed until activated.

## 6. Security measures (as implemented)

- Passwords hashed (bcrypt/`password_hash`); admin TOTP 2FA available.
- Session isolation across the three portals; login throttling on all three.
- CSRF protection on all mutating admin endpoints.
- Uploaded personal documents are **not publicly served** — streamed only through auth-scoped endpoints (`download_document.php`, `media.php`); property listing images remain public by design.
- Webhooks fail closed in production (signature required).
- Least-privilege DB user + offsite backups (deployment).
- Access to personal data is auditable (`data_processing_log`).

## 7. Personal data breach (Art. 33/34)

On a suspected breach: contain, assess scope using `data_processing_log` and server logs, and — if risk to individuals — notify the Garante within **72 hours** and affected subjects without undue delay. Keep an internal breach register.

## 8. Outstanding items for the controller (not software)

- Appoint/designate a DPO if required; publish contact.
- Complete and sign DPAs with the active sub-processors (§5).
- Adopt a written retention policy consistent with `retention_*` settings.
- Verify the `privacy.php` informativa wording with counsel; set the real agency email in settings.
