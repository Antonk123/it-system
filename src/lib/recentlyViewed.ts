const RECENT_TICKETS_KEY = 'recently_viewed_tickets';
const RECENT_KB_KEY = 'recently_viewed_kb';
const MAX_RECENT = 5;

export interface RecentItem {
  id: string;
  title: string;
  visitedAt: number; // Date.now() timestamp
}

/**
 * Reads recently viewed tickets from localStorage.
 * If the stored format is the old format (plain string array of IDs),
 * returns empty array (backward compat — old format lacks titles).
 */
export function getRecentlyViewedTickets(): RecentItem[] {
  try {
    const stored = localStorage.getItem(RECENT_TICKETS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    // Old format was string[] of IDs — detect and ignore
    if (!Array.isArray(parsed)) return [];
    if (parsed.length === 0) return [];
    if (typeof parsed[0] === 'string') return []; // old format
    return parsed as RecentItem[];
  } catch {
    return [];
  }
}

/**
 * Adds a ticket to the recently viewed list.
 * Removes duplicate by id, prepends new item, trims to MAX_RECENT.
 */
export function addRecentlyViewedTicket(id: string, title: string): void {
  try {
    const current = getRecentlyViewedTickets();
    const filtered = current.filter(item => item.id !== id);
    const updated: RecentItem[] = [{ id, title, visitedAt: Date.now() }, ...filtered].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_TICKETS_KEY, JSON.stringify(updated));
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

/**
 * Reads recently viewed KB articles from localStorage.
 */
export function getRecentlyViewedKB(): RecentItem[] {
  try {
    const stored = localStorage.getItem(RECENT_KB_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    if (parsed.length === 0) return [];
    if (typeof parsed[0] === 'string') return []; // old format guard
    return parsed as RecentItem[];
  } catch {
    return [];
  }
}

/**
 * Adds a KB article to the recently viewed list.
 * Removes duplicate by id, prepends new item, trims to MAX_RECENT.
 */
export function addRecentlyViewedKB(id: string, title: string): void {
  try {
    const current = getRecentlyViewedKB();
    const filtered = current.filter(item => item.id !== id);
    const updated: RecentItem[] = [{ id, title, visitedAt: Date.now() }, ...filtered].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KB_KEY, JSON.stringify(updated));
  } catch {
    // Silently fail if localStorage is unavailable
  }
}
