"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import type { CourtListenerDocket } from "@/lib/courtlistener";

interface SearchResponse {
  count: number;
  nextCursor: string | null;
  previousCursor: string | null;
  results: CourtListenerDocket[];
}

interface Filters {
  query: string;
  court: string;
  filedAfter: string;
  filedBefore: string;
}

const EMPTY_FILTERS: Filters = {
  query: "",
  court: "",
  filedAfter: "",
  filedBefore: "",
};

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

  async function runSearch(cursor: string | null) {
    setStatus("loading");
    setError(null);

    const params = new URLSearchParams({ q: filters.query });
    if (filters.court) params.set("court", filters.court);
    if (filters.filedAfter) params.set("filed_after", filters.filedAfter);
    if (filters.filedBefore) params.set("filed_before", filters.filedBefore);
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(`/api/courtlistener/search?${params.toString()}`);
    const body = await res.json();

    if (!res.ok) {
      setStatus("error");
      setError(body.error ?? "Search failed.");
      setData(null);
      return;
    }

    setData(body);
    setStatus("done");
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCursorStack([null]);
    void runSearch(null);
  }

  function goNext() {
    if (!data?.nextCursor) return;
    setCursorStack((stack) => [...stack, data.nextCursor]);
    void runSearch(data.nextCursor);
  }

  function goPrevious() {
    if (cursorStack.length <= 1) return;
    const stack = cursorStack.slice(0, -1);
    setCursorStack(stack);
    void runSearch(stack[stack.length - 1]);
  }

  const canGoPrevious = cursorStack.length > 1;
  const canGoNext = Boolean(data?.nextCursor);
  const isLoading = status === "loading";

  return (
    <main className="page">
      <h1>Class Action Lawsuit Research</h1>
      <p className="subtitle">
        Search U.S. federal class action dockets via the CourtListener API.
      </p>

      <form onSubmit={handleSubmit} className="search-form">
        <input
          type="text"
          value={filters.query}
          onChange={(e) =>
            setFilters((f) => ({ ...f, query: e.target.value }))
          }
          placeholder="e.g. data breach, defective product, wage and hour"
          aria-label="Search class action cases"
        />
        <button type="submit" disabled={status === "loading"}>
          {status === "loading" ? "Searching…" : "Search"}
        </button>
      </form>

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
      </div>

      {status === "error" && <p className="error">{error}</p>}

      {status === "done" && data && (
        <section>
          <p className="result-count">
            {data.count.toLocaleString()} matching dockets
          </p>
          <ul className="results">
            {data.results.map((docket) => (
              <li key={docket.docket_id} className="result">
                <Link href={`/case/${docket.docket_id}`}>
                  {docket.caseName}
                </Link>
                <div className="result-meta">
                  <span>{docket.court}</span>
                  {docket.docketNumber && (
                    <span>No. {docket.docketNumber}</span>
                  )}
                  {docket.dateFiled && <span>Filed {docket.dateFiled}</span>}
                </div>
              </li>
            ))}
          </ul>

          {(canGoPrevious || canGoNext) && (
            <div className="pagination">
              <button
                type="button"
                onClick={goPrevious}
                disabled={!canGoPrevious || isLoading}
              >
                ← Previous
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={!canGoNext || isLoading}
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
