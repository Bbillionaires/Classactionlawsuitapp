# Settlement discovery worker

A small standalone Node service, deployed separately from the Next.js app
(on Railway, alongside its Postgres database), that periodically:

1. Pulls the newest federal class-action dockets from CourtListener.
2. Scans their docket entries for settlement-related keywords.
3. When found, extracts and scores candidate settlement/claims URLs from
   the entry text (and, budget permitting, from an attached document's
   full text where CourtListener actually has it).
4. Upserts what it finds into `settlements` / `settlement_sources`,
   never overwriting a higher-confidence fact with a weaker one.

See `../src/lib/settlements/` in the main app for how this data is read
and displayed — this worker only ever writes; the Next.js app is
read-only against the same database.

## Why this exists as a separate service

The main app has no database and no scheduler — it's a stateless
Next.js app that fetches CourtListener live on every request. This is
the first thing in the project that needs to persist data and run on a
timer, so it's deployed as its own Railway service (with its own
Postgres) rather than bolted onto Vercel, where serverless cron has a
once-a-day cap on the Hobby plan and no good place to run a long-lived
background job.

## Running

```bash
npm install
npm run build
npm start
```

Or for local iteration: `npx tsc -p tsconfig.json --noEmit` to typecheck
without a database connection.

## Environment variables

See `.env.example`. `DATABASE_URL` and `COURTLISTENER_API_TOKEN` are
required; the rest have sane defaults.

## Real limitations (read before trusting this blindly)

- **Extraction only finds a settlement website URL, verification
  metadata, and a coarse status/stage.** It does NOT yet extract claim
  deadlines, settlement amounts, class definitions, or proof
  requirements from document text — that needs actual date/amount
  parsing over unstructured legal prose, which this first pass doesn't
  attempt. Those columns exist in the schema and are ready for a future
  pass to fill in.
- **Low yield is expected, not a bug.** CourtListener/RECAP docket entry
  descriptions are almost always court-clerk boilerplate. The documents
  that actually contain a settlement's claims URL are frequently not
  `is_available` (behind PACER's paywall, never mirrored to RECAP). Most
  scanned dockets will simply produce nothing.
- **Bare `www.example.com` mentions without an `http(s)://` scheme are
  not currently extracted** — only fully-qualified URLs are, to avoid
  false positives from stray text.
- **`KNOWN_ADMINISTRATOR_DOMAINS` in `keywords.ts` is a short, manually
  verified list**, not an exhaustive directory. An unrecognized (but
  entirely legitimate) administrator domain will show up as
  `unverified`/`probable`, not `verified` — that's the intended
  fail-safe behavior, not a bug to "fix" by loosening verification.
