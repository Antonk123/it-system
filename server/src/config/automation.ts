// Automation rules configuration
// Easy to extend — add entries to any of the arrays below.

// ─── Auto-close ───────────────────────────────────────────────────────────────
// Tickets that have been in "resolved" status for this many days are
// automatically moved to "closed" by the daily cron job.
export const AUTO_CLOSE_DAYS = Number(process.env.AUTO_CLOSE_DAYS ?? 30);

// ─── Auto-tag rules ───────────────────────────────────────────────────────────
// When a ticket is created, its TITLE is matched (case-insensitive, word-boundary)
// against each keyword. If matched and the tag exists, it is added automatically.
// Tags are never created automatically — only existing tags are used.
// Word-boundary matching prevents "office" from matching inside "backoffice".
export interface TagRule {
  keyword: string;
  tagName: string;
  tagColor: string;
}

export const TAG_RULES: TagRule[] = [
  { keyword: 'printer',   tagName: 'skrivare',    tagColor: '#f59e0b' },
  { keyword: 'skrivare',  tagName: 'skrivare',    tagColor: '#f59e0b' },
  { keyword: 'nätverk',   tagName: 'nätverk',     tagColor: '#3b82f6' },
  { keyword: 'network',   tagName: 'nätverk',     tagColor: '#3b82f6' },
  { keyword: 'wifi',      tagName: 'nätverk',     tagColor: '#3b82f6' },
  { keyword: 'internet',  tagName: 'nätverk',     tagColor: '#3b82f6' },
  { keyword: 'dator',     tagName: 'dator',       tagColor: '#8b5cf6' },
  { keyword: 'laptop',    tagName: 'dator',       tagColor: '#8b5cf6' },
  { keyword: 'datorn',    tagName: 'dator',       tagColor: '#8b5cf6' },
  { keyword: 'lösenord',  tagName: 'lösenord',    tagColor: '#ec4899' },
  { keyword: 'password',  tagName: 'lösenord',    tagColor: '#ec4899' },
  { keyword: 'email',     tagName: 'e-post',      tagColor: '#06b6d4' },
  { keyword: 'mejl',      tagName: 'e-post',      tagColor: '#06b6d4' },
  { keyword: 'mail',      tagName: 'e-post',      tagColor: '#06b6d4' },
  { keyword: 'telefon',   tagName: 'telefon',     tagColor: '#10b981' },
  { keyword: 'mobil',     tagName: 'telefon',     tagColor: '#10b981' },
  { keyword: 'teams',     tagName: 'teams',       tagColor: '#6366f1' },
  { keyword: 'office',    tagName: 'office',      tagColor: '#ef4444' },
  { keyword: 'windows',   tagName: 'windows',     tagColor: '#0ea5e9' },
  { keyword: 'virus',     tagName: 'säkerhet',    tagColor: '#dc2626' },
  { keyword: 'malware',   tagName: 'säkerhet',    tagColor: '#dc2626' },
  { keyword: 'hack',      tagName: 'säkerhet',    tagColor: '#dc2626' },
];

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
