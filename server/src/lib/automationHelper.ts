import { PRIORITY_RULES } from '../config/automation.js';
import { logger } from './logger.js';

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
      // while still matching Swedish words.
      if (matchesWord(text, keyword)) {
        logger.info('Auto-priority detected', { keyword, priority: rule.priority });
        return rule.priority;
      }
    }
  }

  return null;
}
