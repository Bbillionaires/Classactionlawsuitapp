"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Account-backed counterpart to ./savedSearches.ts's localStorage hook,
 * for a signed-in member — persisted server-side (src/app/api/saved-
 * searches/) so it syncs across devices and can be polled by the
 * discovery worker for new-case email alerts.
 *
 * `TFilters` is whatever shape the caller's search form uses locally
 * (e.g. { query, court, cause, filedAfter, filedBefore, sort }); this
 * module only needs field names, not types, to translate to/from the
 * API's { courtId, filedAfter, filedBefore, ... } body shape.
 */
export interface AccountSavedSearch<TFilters> {
  id: number;
  name: string;
  filters: TFilters;
  alertsEnabled: boolean;
}

interface ApiSavedSearchRow {
  id: number;
  name: string;
  query: string;
  court_id: string | null;
  cause: string | null;
  filed_after: string | null;
  filed_before: string | null;
  sort: string;
  alerts_enabled: boolean;
}

function rowToSaved<
  TFilters extends {
    query: string;
    court: string;
    cause: string;
    filedAfter: string;
    filedBefore: string;
    sort: string;
  },
>(row: ApiSavedSearchRow): AccountSavedSearch<TFilters> {
  return {
    // `pg` returns a BIGSERIAL column (saved_searches.id) as a numeric
    // string, not a JS number (it defaults to preserving int8 precision
    // beyond what a JS number can safely hold) - it round-trips through
    // this app's JSON responses as a string too. Without normalizing it
    // here, every id-based lookup/comparison downstream (remove,
    // toggleAlerts) silently fails: "3" !== 3. Safe to convert plainly -
    // this app will never have anywhere near 2^53 saved searches.
    id: Number(row.id),
    name: row.name,
    alertsEnabled: row.alerts_enabled,
    filters: {
      query: row.query,
      court: row.court_id ?? "",
      cause: row.cause ?? "",
      filedAfter: row.filed_after ?? "",
      filedBefore: row.filed_before ?? "",
      sort: row.sort,
    } as TFilters,
  };
}

export function useAccountSavedSearches<
  TFilters extends {
    query: string;
    court: string;
    cause: string;
    filedAfter: string;
    filedBefore: string;
    sort: string;
  },
>(enabled: boolean) {
  const [savedSearches, setSavedSearches] = useState<AccountSavedSearch<TFilters>[]>([]);
  const [loading, setLoading] = useState(enabled);

  // Plain (non-async) function using a .then()/.catch() chain rather than
  // await, so every setState call is deferred into a promise callback -
  // none happen synchronously within the effect that calls this.
  const refresh = useCallback(() => {
    if (!enabled) return;
    fetch("/api/saved-searches")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!body) return;
        const rows: ApiSavedSearchRow[] = body.savedSearches ?? [];
        setSavedSearches(rows.map((row) => rowToSaved<TFilters>(row)));
      })
      .catch((error) => {
        console.error("Failed to load saved searches:", error);
      })
      .finally(() => setLoading(false));
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function save(name: string, filters: TFilters) {
    const res = await fetch("/api/saved-searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        query: filters.query,
        courtId: filters.court || null,
        cause: filters.cause || null,
        filedAfter: filters.filedAfter || null,
        filedBefore: filters.filedBefore || null,
        sort: filters.sort,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Failed to save search.");
    }
    const body = await res.json();
    setSavedSearches((prev) => [rowToSaved<TFilters>(body.savedSearch), ...prev]);
  }

  async function remove(id: number) {
    // Optimistic: this is a plain delete with no meaningful conflict to
    // reconcile, so just re-sync from the server on failure (including
    // a network error, not just a non-2xx) rather than hand-rolling a
    // rollback of the optimistic update.
    setSavedSearches((prev) => prev.filter((s) => s.id !== id));
    try {
      const res = await fetch(`/api/saved-searches/${id}`, { method: "DELETE" });
      if (!res.ok) void refresh();
    } catch (error) {
      console.error("Failed to delete saved search:", error);
      void refresh();
    }
  }

  async function toggleAlerts(id: number, alertsEnabled: boolean) {
    setSavedSearches((prev) =>
      prev.map((s) => (s.id === id ? { ...s, alertsEnabled } : s)),
    );
    try {
      const res = await fetch(`/api/saved-searches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertsEnabled }),
      });
      if (!res.ok) void refresh();
    } catch (error) {
      console.error("Failed to update saved search alerts:", error);
      void refresh();
    }
  }

  return { savedSearches, loading, save, remove, toggleAlerts };
}
