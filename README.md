# Class Action Lawsuit Research Platform

A Next.js (App Router, TypeScript) foundation for searching, retrieving, and
displaying U.S. federal class action case data via the
[CourtListener REST API](https://www.courtlistener.com/help/api/rest/).

## Architecture

- `src/lib/courtlistener.ts` — server-only CourtListener API client
  (`searchClassActionCases`). Reads the API token from the environment and is
  never imported from client components.
- `src/app/api/courtlistener/search/route.ts` — Route Handler that proxies
  search requests to CourtListener. This is the only place the API token is
  used at request time; the browser never sees it.
- `src/app/page.tsx` — client-side search UI that calls the route handler
  above and renders matching federal dockets.

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

A successful response returns JSON with `count`, `next`, and `results`
(an array of matching federal dockets). A `500` with a config error means
`COURTLISTENER_API_TOKEN` isn't set; a `502` means CourtListener rejected or
failed the request.

## Notes

- Search currently targets CourtListener's RECAP federal docket index
  (`type=r`), which is where class action lawsuits filed in federal court
  live. `searchClassActionCases` also accepts `courtId`, `filedAfter`,
  `filedBefore`, and pagination `cursor` for narrowing results.
- This is an early foundation: API integration and a basic search UI. Case
  detail views, saved searches, filtering by cause of action, and other
  product features are not built yet.
