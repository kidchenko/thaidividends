// Client-side watchlist: a set of starred stock symbols persisted in
// localStorage. Components subscribe to `watchlist:change` to stay in sync -
// a single click on any star button updates every other star button on the
// page plus any home/calendar filter that depends on the set.

const KEY = "watchlist";
const EVENT_NAME = "watchlist:change";

export type WatchlistChange = {
  symbol: string;
  starred: boolean;
};

export function readWatchlist(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

export function isStarred(symbol: string): boolean {
  return readWatchlist().has(symbol);
}

export function toggleStar(symbol: string): boolean {
  const set = readWatchlist();
  const wasStarred = set.has(symbol);
  if (wasStarred) set.delete(symbol);
  else set.add(symbol);
  writeWatchlist(set);
  document.dispatchEvent(
    new CustomEvent<WatchlistChange>(EVENT_NAME, {
      detail: { symbol, starred: !wasStarred },
    }),
  );
  return !wasStarred;
}

export function watchlistSize(): number {
  return readWatchlist().size;
}

export function onWatchlistChange(
  handler: (change: WatchlistChange) => void,
): () => void {
  const wrapped = (e: Event) => {
    const detail = (e as CustomEvent<WatchlistChange>).detail;
    if (detail) handler(detail);
  };
  document.addEventListener(EVENT_NAME, wrapped);
  return () => document.removeEventListener(EVENT_NAME, wrapped);
}

function writeWatchlist(set: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...set].sort()));
  } catch {
    // Quota exceeded or storage disabled - silently no-op.
  }
}

export const WATCHLIST_STORAGE_KEY = KEY;
export const WATCHLIST_EVENT_NAME = EVENT_NAME;
