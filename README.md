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
  live. `searchClassActionCases` also accepts `courtId`, `filedAfter`,
  `filedBefore`, and a pagination `cursor` for narrowing results.
- CourtListener rate-limits unauthenticated-tier tokens fairly aggressively;
  the case detail page shows a friendly message on `429` instead of
  crashing.
- This is still an early foundation. Saved searches, filtering by cause of
  action, and other product features are not built yet.
