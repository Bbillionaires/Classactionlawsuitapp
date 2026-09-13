# Settlement discovery worker

A small standalone Node service, deployed separately from the Next.js app
(on Railway, alongside its Postgres database), that runs two independent
discovery paths every scheduled run, then upserts whatever either one
finds into `settlements` / `settlement_sources` — never overwriting a
higher-confidence fact with a weaker one.

**Path 1 — CourtListener text search** (`discover.ts`): searches RECAP's
full text for class-action dockets whose own record already mentions
settlement-stage language (preliminary/final approval, claims
administrator, etc.), scans matching entries for the 16-item keyword
list plus known-administrator mentions, and extracts/scores any
candidate settlement URL found.

**Path 2 — aggregator leads** (`aggregator.ts` /
`discoverFromAggregator.ts`): Top Class Actions' public "open
settlements" listing is used strictly as a LEAD source, per this
project's design rule — it tells us a settlement exists and gives
structured fields to check (case name, docket number, official
settlement site, deadlines, award, proof requirement), but nothing from
it is trusted as-is. Each lead is cross-referenced against
CourtListener's own docket index to find a real docket to link to
(docket *metadata* — parties, court, filing date — is public even when
the actual filed documents are paywalled and never mirrored to RECAP,
which is why Path 1 alone misses real settlements Path 2 catches), and
the official site's domain still only earns `verified` if it's on the
known-administrator allowlist — otherwise it's `probable`, same as
everything else, with the source disclosed plainly on the case page.

See `../src/lib/settlements/` in the main app for how this data is read
and displayed — this worker only ever writes; the Next.js app is
read-only against the same database.

## A note on how Path 2 gets past Cloudflare

Top Class Actions sits behind Cloudflare's bot check, which serves a
403 JS-challenge page to a plain, honestly-identified request — this
was confirmed while building this feature, not assumed. `aggregator.ts`
presents a Chrome User-Agent and browser-like Accept headers to get a
real response. That's a deliberate choice made explicitly at the
project owner's direction after they were shown the alternative (not
automating this source at all), not something this codebase reaches
for quietly. `robots.txt` does not disallow the paths this worker
reads; requests are still spaced out (`MIN_MS_BETWEEN_REQUESTS` in
`aggregator.ts`) to stay a low-volume, infrequent reader rather than a
scraper trying to extract their whole database.

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

- **Path 1 (CourtListener text search) still only extracts a bare
  settlement URL, not the richer fields** — its docket-entry text is
  unstructured legal prose, and this codebase doesn't attempt real
  date/amount parsing over it. Path 2 (aggregator leads) does populate
  the richer fields (award, deadlines, class definition, proof
  requirement) because TCA's own pages are already structured with
  stable field labels — but that means those specific fields, for
  aggregator-sourced rows, ultimately trace back to TCA's own summary of
  the settlement, not to a court document we parsed ourselves.
- **Path 1's yield is low, and that's expected, not a bug.**
  CourtListener/RECAP docket entry descriptions are almost always
  court-clerk boilerplate, and the documents that actually contain a
  settlement's claims URL are frequently not `is_available` (behind
  PACER's paywall, never mirrored to RECAP). Most scanned dockets
  produce nothing — Path 2 exists specifically because Path 1 alone has
  a structural ceiling here.
- **Path 2 depends on Top Class Actions' page structure staying stable.**
  Field extraction keys off specific heading ids (`h-case-name`,
  `h-settlement-website`, etc. — see `aggregator.ts`); a redesign of
  their site would silently start returning fewer/no fields rather than
  erroring loudly. The deadline heading's id is already known to vary
  between settlement types (`h-exclusion-deadline` vs.
  `h-exclusion-and-objection-deadline` vs. others) — `fieldTextByIdContains`
  tries several known variants, but an entirely new one would return
  null rather than crash.
- **Path 2 only publishes a lead it can match to a real CourtListener
  docket** — a genuine settlement whose case CourtListener has never
  indexed at all (rare, but possible) is silently skipped rather than
  shown without a docket to link to.
- **Bare `www.example.com` mentions without an `http(s)://` scheme are
  not currently extracted** by Path 1 — only fully-qualified URLs are,
  to avoid false positives from stray text.
- **`KNOWN_ADMINISTRATOR_DOMAINS` in `keywords.ts` is a short, manually
  verified list**, not an exhaustive directory. An unrecognized (but
  entirely legitimate) administrator domain — including most
  aggregator-lead official sites, which are typically per-case vanity
  domains like `kohama2026settlement.com` rather than a fixed company
  domain — will show up as `probable`, not `verified`. That's the
  intended fail-safe behavior, not a bug to "fix" by loosening
  verification.
