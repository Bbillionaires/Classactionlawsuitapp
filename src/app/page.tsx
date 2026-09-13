"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { CourtListenerDocket } from "@/lib/courtlistener";
import { useSavedSearches, type SavedSearch } from "@/lib/savedSearches";
import OpenClaimsSection from "./components/OpenClaimsSection";

const RATE_LIMIT_COOLDOWN_SECONDS = 15;

interface SearchResponse {
  count: number;
  nextCursor: string | null;
  previousCursor: string | null;
  results: CourtListenerDocket[];
}

type SortOrder = "relevance" | "newest" | "oldest";

interface Filters {
  query: string;
  court: string;
  filedAfter: string;
  filedBefore: string;
  cause: string;
  sort: SortOrder;
}

const EMPTY_FILTERS: Filters = {
  query: "",
  court: "",
  filedAfter: "",
  filedBefore: "",
  cause: "",
  sort: "newest",
};

function describeFilters(filters: Filters): string {
  const parts = [filters.query || "(any keyword)"];
  if (filters.court) parts.push(`court: ${filters.court}`);
  if (filters.cause) parts.push(`cause: ${filters.cause}`);
  if (filters.filedAfter) parts.push(`filed after ${filters.filedAfter}`);
  if (filters.filedBefore) parts.push(`filed before ${filters.filedBefore}`);
  if (filters.sort !== "newest") parts.push(`sort: ${filters.sort}`);
  return parts.join(" · ");
}

export default function Home() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);
  // Cursor history lets "Previous" step back without CourtListener's own
  // previous-page cursor (which points at a different page than "no cursor").
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [cooldown, setCooldown] = useState(0);
  const [saveName, setSaveName] = useState("");
  const {
    savedSearches,
    save: saveSearch,
    remove: removeSavedSearch,
  } = useSavedSearches<Filters>();

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // Show a feed of recent lawsuits immediately, before the user searches
  // for anything — an empty search form with no results is a bad first look.
  useEffect(() => {
    void runSearch(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Accepts an explicit filters override so running a saved search doesn't
  // race React's async state update to `filters`.
  async function runSearch(cursor: string | null, overrideFilters?: Filters) {
    const activeFilters = overrideFilters ?? filters;
    setStatus("loading");
    setError(null);

    const params = new URLSearchParams({ q: activeFilters.query });
    if (activeFilters.court) params.set("court", activeFilters.court);
    if (activeFilters.filedAfter)
      params.set("filed_after", activeFilters.filedAfter);
    if (activeFilters.filedBefore)
      params.set("filed_before", activeFilters.filedBefore);
    if (activeFilters.cause) params.set("cause", activeFilters.cause);
    if (cursor) params.set("cursor", cursor);
    params.set("sort", activeFilters.sort);

    const res = await fetch(`/api/courtlistener/search?${params.toString()}`);
    const body = await res.json();

    if (!res.ok) {
      setStatus("error");
      setError(body.error ?? "Search failed.");
      setData(null);
      if (res.status === 429) setCooldown(RATE_LIMIT_COOLDOWN_SECONDS);
      return;
    }

    setData(body);
    setStatus("done");
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "loading" || cooldown > 0) return;
    setCursorStack([null]);
    void runSearch(null);
  }

  function goNext() {
    if (!data?.nextCursor || status === "loading" || cooldown > 0) return;
    setCursorStack((stack) => [...stack, data.nextCursor]);
    void runSearch(data.nextCursor);
  }

  function goPrevious() {
    if (cursorStack.length <= 1 || status === "loading" || cooldown > 0) return;
    const stack = cursorStack.slice(0, -1);
    setCursorStack(stack);
    void runSearch(stack[stack.length - 1]);
  }

  function handleSaveSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = saveName.trim();
    if (!name) return;
    saveSearch(name, filters);
    setSaveName("");
  }

  function runSavedSearch(saved: SavedSearch<Filters>) {
    if (status === "loading" || cooldown > 0) return;
    setFilters(saved.filters);
    setCursorStack([null]);
    void runSearch(null, saved.filters);
  }

  const canGoPrevious = cursorStack.length > 1;
  const canGoNext = Boolean(data?.nextCursor);
  const isLoading = status === "loading";
  const isBlocked = isLoading || cooldown > 0;

  return (
    <main className="page">
      <OpenClaimsSection />

      <h1>All Class Action Lawsuits</h1>
      <p className="subtitle">
        Browse newly filed U.S. federal class action lawsuits, or search for
        a specific case. Most of these are still pending — see the Open
        Claims section above for settlements you can file on now.
      </p>

      <form onSubmit={handleSubmit} className="search-form">
        <input
          type="text"
          value={filters.query}
          onChange={(e) =>
            setFilters((f) => ({ ...f, query: e.target.value }))
          }
          placeholder="Search by company, product, or topic (optional)"
          aria-label="Search class action lawsuits"
        />
        <button type="submit" disabled={isBlocked}>
          {isLoading
            ? "Searching…"
            : cooldown > 0
              ? `Wait ${cooldown}s…`
              : "Search"}
        </button>
      </form>

      <details className="filters-details">
        <summary>More filters</summary>
        <div className="filters-row">
          <label>
            Court ID
            <input
              type="text"
              value={filters.court}
              onChange={(e) =>
                setFilters((f) => ({ ...f, court: e.target.value }))
              }
              placeholder="e.g. cand, nysd"
            />
          </label>
          <label>
            Cause of action
            <input
              type="text"
              value={filters.cause}
              onChange={(e) =>
                setFilters((f) => ({ ...f, cause: e.target.value }))
              }
              placeholder="e.g. Class Action Fairness Act, TCPA"
            />
          </label>
          <label>
            Filed after
            <input
              type="date"
              value={filters.filedAfter}
              onChange={(e) =>
                setFilters((f) => ({ ...f, filedAfter: e.target.value }))
              }
            />
          </label>
          <label>
            Filed before
            <input
              type="date"
              value={filters.filedBefore}
              onChange={(e) =>
                setFilters((f) => ({ ...f, filedBefore: e.target.value }))
              }
            />
          </label>
          <label>
            Sort by
            <select
              value={filters.sort}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  sort: e.target.value as SortOrder,
                }))
              }
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="relevance">Relevance</option>
            </select>
          </label>
        </div>
      </details>

      <div className="saved-searches">
        <form onSubmit={handleSaveSearch} className="save-search-form">
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Name this search to save it"
            aria-label="Name this search"
          />
          <button type="submit" disabled={!saveName.trim()}>
            Save search
          </button>
        </form>

        {savedSearches.length > 0 && (
          <ul className="saved-searches-list">
            {savedSearches.map((saved) => (
              <li key={saved.id} className="saved-search">
                <button
                  type="button"
                  onClick={() => runSavedSearch(saved)}
                  disabled={isBlocked}
                  title={describeFilters(saved.filters)}
                >
                  {saved.name}
                </button>
                <button
                  type="button"
                  className="saved-search-delete"
                  onClick={() => removeSavedSearch(saved.id)}
                  aria-label={`Delete saved search "${saved.name}"`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {status === "error" && <p className="error">{error}</p>}

      {(status === "idle" || (status === "loading" && !data)) && (
        <p className="result-count">Loading recent lawsuits…</p>
      )}

      {data && (
        <section>
          <p className="result-count">
            {filters.query
              ? `${data.count.toLocaleString()} lawsuits matching "${filters.query}"`
              : "Most recently filed lawsuits"}
            {status === "loading" && " (updating…)"}
          </p>
          <ul className="results">
            {data.results.map((docket) => (
              <li key={docket.docket_id} className="result">
                <div className="result-title">
                  <span
                    className={`status-badge ${
                      docket.dateTerminated
                        ? "status-closed"
                        : "status-pending"
                    }`}
                  >
                    {docket.dateTerminated ? "Closed" : "Pending"}
                  </span>
                  <Link href={`/case/${docket.docket_id}`}>
                    {docket.caseName}
                  </Link>
                </div>
                <div className="result-meta">
                  <span>{docket.court}</span>
                  {docket.docketNumber && (
                    <span>No. {docket.docketNumber}</span>
                  )}
                  {docket.dateFiled && <span>Filed {docket.dateFiled}</span>}
                  {docket.cause && <span>{docket.cause}</span>}
                </div>
              </li>
            ))}
          </ul>

          {(canGoPrevious || canGoNext) && (
            <div className="pagination">
              <button
                type="button"
                onClick={goPrevious}
                disabled={!canGoPrevious || isBlocked}
              >
                ← Previous
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={!canGoNext || isBlocked}
              >
                Next →
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
