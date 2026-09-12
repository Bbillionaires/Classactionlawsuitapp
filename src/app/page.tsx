"use client";

import { FormEvent, useState } from "react";
import type { CourtListenerDocket } from "@/lib/courtlistener";

interface SearchResponse {
  count: number;
  next: string | null;
  results: CourtListenerDocket[];
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);

  async function runSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setError(null);

    const params = new URLSearchParams({ q: query });
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

  return (
    <main className="page">
      <h1>Class Action Lawsuit Research</h1>
      <p className="subtitle">
        Search U.S. federal class action dockets via the CourtListener API.
      </p>

      <form onSubmit={runSearch} className="search-form">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. data breach, defective product, wage and hour"
          aria-label="Search class action cases"
        />
        <button type="submit" disabled={status === "loading"}>
          {status === "loading" ? "Searching…" : "Search"}
        </button>
      </form>

      {status === "error" && <p className="error">{error}</p>}

      {status === "done" && data && (
        <section>
          <p className="result-count">{data.count.toLocaleString()} matching dockets</p>
          <ul className="results">
            {data.results.map((docket) => (
              <li key={docket.docket_id} className="result">
                <a
                  href={`https://www.courtlistener.com${docket.docket_absolute_url}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {docket.caseName}
                </a>
                <div className="result-meta">
                  <span>{docket.court}</span>
                  {docket.docketNumber && <span>No. {docket.docketNumber}</span>}
                  {docket.dateFiled && <span>Filed {docket.dateFiled}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
