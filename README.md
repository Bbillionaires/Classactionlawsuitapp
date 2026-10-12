# Class Action Lawsuit Research Platform

A Next.js (App Router, TypeScript) foundation for searching, retrieving, and
displaying U.S. federal class action case data via the
[CourtListener REST API](https://www.courtlistener.com/help/api/rest/).

## Architecture

- `src/lib/courtlistener.ts` — server-only CourtListener API client
  (`searchClassActionCases`, `getDocketById`, `getDocketEntries`). Reads the
  API token from the environment and is never imported from client
  components. Search pagination cursors are extracted from CourtListener's
  `next`/`previous` URLs so only an opaque cursor string is ever exposed
  outside this module.
- `src/app/api/courtlistener/search/route.ts` — Route Handler that proxies
  search requests to CourtListener. This is the only place the API token is
  used at request time; the browser never sees it.
- `src/app/page.tsx` — client-side search UI (query, court, and filed-date
  filters, plus cursor-based pagination) that calls the route handler above.
- `src/app/case/[id]/page.tsx` — server-rendered case detail page: docket
  facts (court, cause, nature of suit, assigned judge, etc.) and the full
  docket entry / filing history, calling the CourtListener client directly
  since it never needs to run in the browser.

## Setup

1. Copy `.env.example` to `.env.local`:

   ```bash
   cp .env.example .env.local
   ```

2. Set `COURTLISTENER_API_TOKEN` in `.env.local` to your CourtListener API
   token. Get one from your account at
   https://www.courtlistener.com/help/api/rest/#authentication.

   `.env.local` is git-ignored — the token is never committed.

3. Install dependencies and run the dev server:

   ```bash
   npm install
   npm run dev
   ```

4. Open http://localhost:3000 and search for a case (e.g. "data breach").

## Verifying the CourtListener connection

With the dev server running:

```bash
curl "http://localhost:3000/api/courtlistener/search?q=data+breach"
```

A successful response returns JSON with `count`, `nextCursor`,
`previousCursor`, and `results` (an array of matching federal dockets). A
`500` with a config error means `COURTLISTENER_API_TOKEN` isn't set; a `502`
means CourtListener rejected or failed the request.

Visiting `/case/<docket_id>` (e.g. `/case/72031934`) renders that docket's
detail page directly from the CourtListener client.

## Notes

- Search currently targets CourtListener's RECAP federal docket index
  (`type=r`), which is where class action lawsuits filed in federal court
  live. `searchClassActionCases` also accepts `courtId`, `cause`,
  `filedAfter`, `filedBefore`, and a pagination `cursor` for narrowing
  results.
- CourtListener rate-limits unauthenticated-tier tokens fairly aggressively;
  the case detail page shows a friendly message on `429` instead of
  crashing. Search responses are also cached for 5 minutes
  (`next: { revalidate: 300 }` in `src/lib/courtlistener.ts`) to reduce how
  often that shared budget gets hit.

## Status

**What works**

- Case search (query, court, cause-of-action, and filed-date filters) with
  cursor-based pagination, backed by CourtListener's RECAP index.
- Case detail pages with full docket facts and filing history.
- Member accounts (sign up / log in, JWT session cookie) and a claim
  authorization + claim-request + document-upload flow for settlements the
  discovery worker has found (`src/lib/members/`, `src/lib/settlements/`).
- Saved searches tied to a signed-in member's account (`src/app/api/saved-
  searches/`, `src/lib/accountSavedSearches.ts`), synced across devices,
  replacing the earlier browser-local-only version
  (`src/lib/savedSearches.ts`, still used for a signed-out visitor).
- Opt-in email alerts (via Resend) when a saved search's re-run turns up
  genuinely new matching cases, sent by the standalone `worker/`
  settlement-discovery service (`worker/src/savedSearchAlerts.ts`). A
  search's first check only seeds a "seen" baseline — it never emails the
  member's entire existing match history the moment alerts are turned on.
- Settlement discovery: the worker also finds and scores candidate
  settlements for indexed dockets (CourtListener text search, plus Top
  Class Actions' public listing used strictly as a cross-referenced lead
  source — see `worker/README.md` for the full design rationale and known
  limitations of both paths).

**What's left**

- No automated test suite in either package yet — `npm run build` /
  `npm run lint` (main app) and `npm run build` / `npm run typecheck`
  (worker) are the only checks run today.
- Saved-search alert checking is bounded and rotating
  (`SAVED_SEARCH_ALERTS_PER_RUN`), not real-time — see the "Real
  limitations" section of `worker/README.md`.
- Settlement-discovery Path 1 (CourtListener text search) has a low yield
  by design (most matching docket entries are behind PACER's paywall);
  Path 2 (aggregator leads) depends on a third-party site's page structure
  staying stable. Neither is a bug to "fix" by loosening verification —
  see `worker/README.md`.
- No admin/moderation UI for reviewing or correcting discovered
  settlement data — it's only ever written by the worker and read by the
  main app.

**How to run**

- Main app: see [Setup](#setup) above (`npm install && npm run dev`).
  Requires `DATABASE_URL` (shared with the worker), `SESSION_SECRET`, and
  `BLOB_READ_WRITE_TOKEN` in addition to `COURTLISTENER_API_TOKEN` for the
  member-account features to work; see `.env.example` for the full list
  and which ones degrade gracefully when unset.
- Worker: see `worker/README.md` (`cd worker && npm install && npm run
  build && npm start`). It's a one-shot script, not a server — an external
  scheduler (Railway, in production) triggers each run.

**Where it's deployed**

- Main app: Vercel, at [classactionpayouts.com](https://classactionpayouts.com).
- Worker + Postgres: Railway, as a separately-scheduled service sharing the
  same database the main app's member/saved-search/settlement tables live
  in (see "Why this exists as a separate service" in `worker/README.md`).
