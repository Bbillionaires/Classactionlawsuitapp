"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "classActionSavedSearches";

export interface SavedSearch<T> {
  id: string;
  name: string;
  filters: T;
  createdAt: string;
}

type Listener = () => void;

let listeners: Listener[] = [];

function emitChange(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

// useSyncExternalStore requires getSnapshot/getServerSnapshot to return a
// referentially stable value when the underlying data hasn't changed, or
// it'll (rightly) warn about a possible infinite loop.
const EMPTY_SNAPSHOT: SavedSearch<unknown>[] = [];

let cachedRaw: string | null = null;
let cachedParsed: SavedSearch<unknown>[] = EMPTY_SNAPSHOT;

function readStore(): SavedSearch<unknown>[] {
  if (typeof window === "undefined") return EMPTY_SNAPSHOT;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedParsed;
  cachedRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) : EMPTY_SNAPSHOT;
    cachedParsed = Array.isArray(parsed) ? parsed : EMPTY_SNAPSHOT;
  } catch {
    cachedParsed = EMPTY_SNAPSHOT;
  }
  return cachedParsed;
}

function getServerSnapshot(): SavedSearch<unknown>[] {
  return EMPTY_SNAPSHOT;
}

function writeStore(searches: SavedSearch<unknown>[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
  } catch {
    // Storage full or unavailable (e.g. private browsing) — fail silently.
  }
  emitChange();
}

/**
 * Saved searches backed by this browser's localStorage — no server
 * involved. Reads are synchronized via useSyncExternalStore so the list
 * updates immediately after `save`/`remove`, with no SSR/hydration
 * mismatch (the server snapshot is always an empty list).
 */
export function useSavedSearches<T>(): {
  savedSearches: SavedSearch<T>[];
  save: (name: string, filters: T) => void;
  remove: (id: string) => void;
} {
  const savedSearches = useSyncExternalStore(
    subscribe,
    readStore,
    getServerSnapshot,
  ) as SavedSearch<T>[];

  function save(name: string, filters: T): void {
    const next: SavedSearch<T>[] = [
      {
        id: crypto.randomUUID(),
        name,
        filters,
        createdAt: new Date().toISOString(),
      },
      ...(readStore() as SavedSearch<T>[]),
    ];
    writeStore(next);
  }

  function remove(id: string): void {
    const next = (readStore() as SavedSearch<T>[]).filter(
      (s) => s.id !== id,
    );
    writeStore(next);
  }

  return { savedSearches, save, remove };
}
