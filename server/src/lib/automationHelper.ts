import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { TAG_RULES, PRIORITY_RULES } from '../config/automation.js';
import { logger } from './logger.js';

// ─── Auto-tag ─────────────────────────────────────────────────────────────────

/**
 * Word-boundary match using Unicode-aware lookarounds.
 * JS `\b` is ASCII-only, so it misclassifies Swedish words like "är" or
 * "lösenord" when surrounded by non-ASCII letters. Using \p{L}/\p{N} matches
 * letters/numbers across Unicode categories.
 */
function matchesWord(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

/**
 * Applies auto-tags to a newly created ticket based on TAG_RULES.
 * Only matches against the title (not description) using word-boundary matching.
 * Only applies tags that already exist — never creates new ones.
 */
export function applyAutoTags(ticketId: string, title: string, _description: string): void {
  const addedTagNames = new Set<string>();

  for (const rule of TAG_RULES) {
    if (!matchesWord(title, rule.keyword)) continue;
    if (addedTagNames.has(rule.tagName)) continue;

    // Only use existing tags — never create new ones
    const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(rule.tagName) as { id: string } | undefined;
    if (!tag) continue;

    // Link tag to ticket (ignore if already linked)
    const exists = db.prepare('SELECT 1 FROM ticket_tags WHERE ticket_id = ? AND tag_id = ?').get(ticketId, tag.id);
    if (!exists) {
      db.prepare('INSERT INTO ticket_tags (id, ticket_id, tag_id) VALUES (?, ?, ?)').run(
        uuidv4(),
        ticketId,
        tag.id
      );
      logger.info('Auto-tag applied', { tag: rule.tagName, ticketId });
    }

    addedTagNames.add(rule.tagName);
  }
}

// ─── Auto-priority ────────────────────────────────────────────────────────────

/**
 * Returns the auto-detected priority based on PRIORITY_RULES.
 * Returns null if no rule matches (caller should keep the default).
 * Only call this when the user has NOT explicitly set a priority.
 */
export function detectAutoPriority(
  title: string,
  description: string
): 'low' | 'medium' | 'high' | 'critical' | null {
  const text = `${title} ${description}`;

  for (const rule of PRIORITY_RULES) {
    for (const keyword of rule.keywords) {
      // Word-boundary match keeps "password" from triggering inside "passwordless"
      // and matches the auto-tag behavior in matchesWord above.
      if (matchesWord(text, keyword)) {
        logger.info('Auto-priority detected', { keyword, priority: rule.priority });
        return rule.priority;
      }
    }
  }

  return null;
}
