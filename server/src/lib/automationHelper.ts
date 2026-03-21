import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { TAG_RULES, PRIORITY_RULES } from '../config/automation.js';

// ─── Auto-tag ─────────────────────────────────────────────────────────────────

/**
 * Applies auto-tags to a newly created ticket based on TAG_RULES.
 * Tags are created on first use; existing tags are reused.
 * Runs inside the same synchronous DB context as ticket creation.
 */
export function applyAutoTags(ticketId: string, title: string, description: string): void {
  const text = `${title} ${description}`.toLowerCase();
  const addedTagNames = new Set<string>();

  for (const rule of TAG_RULES) {
    if (!text.includes(rule.keyword.toLowerCase())) continue;
    if (addedTagNames.has(rule.tagName)) continue; // already added this tag

    // Find or create the tag
    let tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(rule.tagName) as { id: string } | undefined;
    if (!tag) {
      const newId = uuidv4();
      db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(
        newId,
        rule.tagName,
        rule.tagColor
      );
      tag = { id: newId };
      console.log(`🏷️  Auto-tag: created new tag "${rule.tagName}"`);
    }

    // Link tag to ticket (ignore if already linked)
    const exists = db.prepare('SELECT 1 FROM ticket_tags WHERE ticket_id = ? AND tag_id = ?').get(ticketId, tag.id);
    if (!exists) {
      db.prepare('INSERT INTO ticket_tags (id, ticket_id, tag_id) VALUES (?, ?, ?)').run(
        uuidv4(),
        ticketId,
        tag.id
      );
      console.log(`🏷️  Auto-tag: applied "${rule.tagName}" to ticket ${ticketId}`);
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
  const text = `${title} ${description}`.toLowerCase();

  for (const rule of PRIORITY_RULES) {
    for (const keyword of rule.keywords) {
      if (text.includes(keyword.toLowerCase())) {
        console.log(`⚡ Auto-priority: keyword "${keyword}" → ${rule.priority}`);
        return rule.priority;
      }
    }
  }

  return null;
}
