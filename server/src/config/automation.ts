// Automation rules configuration
// Easy to extend — add entries to any of the arrays below.

// ─── Auto-close ───────────────────────────────────────────────────────────────
// Tickets that have been in "resolved" status for this many days are
// automatically moved to "closed" by the daily cron job.
export const AUTO_CLOSE_DAYS = Number(process.env.AUTO_CLOSE_DAYS ?? 30);

// ─── Auto-priority rules ──────────────────────────────────────────────────────
// Applied only when the user has NOT explicitly set a priority.
// Rules are evaluated in order; the first match wins.
// Priority values: 'low' | 'medium' | 'high' | 'critical'
export interface PriorityRule {
  keywords: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export const PRIORITY_RULES: PriorityRule[] = [
  {
    keywords: ['kritisk', 'kritiskt', 'akut', 'nödsituation', 'emergency', 'critical', 'brand', 'intrång'],
    priority: 'critical',
  },
  {
    keywords: ['ner', 'nere', 'ned', 'fungerar inte', 'slutat fungera', 'down', 'kraschar', 'crash', 'blå skärm'],
    priority: 'high',
  },
  {
    keywords: ['brådskande', 'urgent', 'snabbt', 'asap', 'viktigt', 'important'],
    priority: 'high',
  },
];
