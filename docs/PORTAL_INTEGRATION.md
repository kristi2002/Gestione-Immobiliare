# Portal integration — Immobiliare.it / Idealista / Casa.it

> The honest reality of publishing to the big Italian portals, and how this app is
> wired to plug in once the agency has an account.

## Do we have to pay? — Yes.

There is **no free or open API** for Immobiliare.it (Gruppo Immobiliare.it / EQT),
Idealista, or Casa.it. Publishing listings requires the agency to have a **paid
account / listing subscription**. The technical integration is gated behind that
contract:

- **Feed-based (the common path):** you expose an **XML feed URL**; the portal is
  configured — on *their* side, after you're a customer — to pull it on a schedule.
- **Partner/API programme:** also requires the contract + technical onboarding and
  their **current field spec** (handed to contracted agencies/partners).

You cannot "connect" from code alone, and scraping/reverse-engineering their site is
against their terms and will get the account banned — so we don't do it.

## What's built here (ready to plug in)

- **XML feed:** `GET /api/property_export.php?format=xml` — all active properties with
  the listing fields portals expect (type, contract, address, size, rooms, price,
  **energy class/IPE, heating, elevator, furnished, condo fees, exposure**, geo, owner
  contact) **plus public image URLs**. JSON and CSV variants also exist.
- **Per-portal publish state:** the **Pubblicazioni Portali** module (`portal_listings`
  + `api/portal_sync.php`) tracks, per property per portal, a status
  (bozza/in pubblicazione/pubblicato/errore/rimosso), the external listing id/URL, and
  last-sync time — so an agent can see at a glance where each listing is live.

## Go-live steps (once Orlandi has the account)

1. Get the portal's **current feed spec** (field names/enums) from the onboarding contact.
2. Align the tag mapping in `exportXml()` to that spec (the tags today are a common-field
   superset — a small mapping pass, not a rebuild).
3. Publish the feed at a **stable, authenticated URL** (or an allow-listed one the portal
   can reach) over HTTPS; images must be publicly reachable (`uploads/properties/` is public
   by design — sensitive docs stay denied).
4. Give the portal the feed URL; they schedule the pull.
5. Track each listing's state in **Pubblicazioni Portali**; a future job can flip status to
   `errore` on feed-validation failures.

## Cost expectation (for the client conversation)

Portal listing plans are an **agency subscription** (monthly/annual, priced by listing
volume/visibility). Budget for it as an operating cost of the agency, separate from this
software. Present portal publishing in the demo as **"pronto, in attivazione all'attivazione
dell'account portale"**, not as already-live.
