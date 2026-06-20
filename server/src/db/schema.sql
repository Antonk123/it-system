-- Users with login credentials
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_login TEXT
);

-- Companies (kopplas till contacts och tickets via company_id; skapas i migration 028)
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  org_number TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  -- Tillagd via migration (guard: columnExists):
  sla_disabled INTEGER NOT NULL DEFAULT 0,  -- migration 045
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Contacts (ticket requesters without login)
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company TEXT,
  -- Tillagda via migrationer (alla guards: columnExists):
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,  -- migration 028
  department TEXT,                                               -- migration 036
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Tickets
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT DEFAULT 'open' CHECK(status IN ('open', 'in-progress', 'waiting', 'resolved', 'closed')),
  priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  requester_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  notes TEXT,
  solution TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  closed_at TEXT,
  -- Tillagda via migrationer (alla guards: columnExists):
  template_id TEXT,                                                                     -- migration 004
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,                          -- migration 029
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,                             -- migration 029
  sla_response_deadline TEXT,                                                           -- migration 031
  sla_resolution_deadline TEXT,                                                         -- migration 031
  sla_paused_at TEXT,                                                                   -- migration 031
  sla_paused_duration INTEGER DEFAULT 0,                                                -- migration 031
  sla_response_met INTEGER,                                                             -- migration 031
  sla_resolution_met INTEGER,                                                           -- migration 031
  ai_suggested_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,          -- migration 037
  ai_suggested_confidence REAL,                                                         -- migration 037
  ai_draft_response TEXT,                                                               -- migration 037
  ai_draft_updated_at TEXT,                                                             -- migration 037
  ai_summary_json TEXT,                                                                 -- migration 037
  ai_summary_updated_at TEXT,                                                           -- migration 037
  email_message_id TEXT,                                                                -- migration 040
  last_aging_notified_at TEXT,                                                          -- migration 044
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL                              -- migration 058
);

-- Ticket attachments
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  file_type TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Ticket checklists
CREATE TABLE IF NOT EXISTS ticket_checklists (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  completed INTEGER DEFAULT 0,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Ticket comments (internal notes)
CREATE TABLE IF NOT EXISTS ticket_comments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_internal INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT DEFAULT NULL
);

-- Ticket shares (public share tokens)
CREATE TABLE IF NOT EXISTS ticket_shares (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  share_token TEXT UNIQUE NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Ticket links (bidirectional relationships)
CREATE TABLE IF NOT EXISTS ticket_links (
  id TEXT PRIMARY KEY,
  source_ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  target_ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  link_type TEXT DEFAULT 'related' CHECK(link_type IN ('related')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Tags (custom labels for organizing tickets)
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#3b82f6',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Ticket tags (many-to-many relationship)
CREATE TABLE IF NOT EXISTS ticket_tags (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ticket_id, tag_id)
);

-- Ticket reminders (scheduled email notifications)
CREATE TABLE IF NOT EXISTS ticket_reminders (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_time TEXT NOT NULL,
  message TEXT,
  sent INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT DEFAULT NULL
);

-- Knowledge Base categories
CREATE TABLE IF NOT EXISTS kb_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Knowledge Base articles
CREATE TABLE IF NOT EXISTS kb_articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES kb_categories(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- KB article public share tokens
CREATE TABLE IF NOT EXISTS kb_article_shares (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  share_token TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Refresh tokens (for JWT token rotation)
-- OBS: måste matcha migration 027 exakt — fresh-install skapar tabellen här och
-- migration 027 hoppar då över (tableExists-guard). Kolumn + index måste därför
-- finnas redan här, annars saknas idx_refresh_tokens_token på fresh-installs.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- Ticket <-> KB article links
CREATE TABLE IF NOT EXISTS ticket_kb_links (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ticket_id, article_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_category ON tickets(category_id);
CREATE INDEX IF NOT EXISTS idx_tickets_requester ON tickets(requester_id);
CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket ON ticket_attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_checklists_ticket ON ticket_checklists(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_created ON ticket_comments(created_at);
CREATE INDEX IF NOT EXISTS idx_ticket_shares_token ON ticket_shares(share_token);
CREATE INDEX IF NOT EXISTS idx_ticket_links_source ON ticket_links(source_ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_links_target ON ticket_links(target_ticket_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_links_unique ON ticket_links(source_ticket_id, target_ticket_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_ticket_tags_ticket ON ticket_tags(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_tags_tag ON ticket_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_ticket_reminders_ticket ON ticket_reminders(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_reminders_user ON ticket_reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_reminders_time ON ticket_reminders(reminder_time);
CREATE INDEX IF NOT EXISTS idx_ticket_reminders_sent ON ticket_reminders(sent);
CREATE INDEX IF NOT EXISTS idx_kb_article_shares_token ON kb_article_shares(share_token);
CREATE INDEX IF NOT EXISTS idx_kb_article_shares_article ON kb_article_shares(article_id);
CREATE INDEX IF NOT EXISTS idx_kb_articles_category ON kb_articles(category_id);
CREATE INDEX IF NOT EXISTS idx_kb_articles_updated ON kb_articles(updated_at);
CREATE INDEX IF NOT EXISTS idx_ticket_kb_links_ticket ON ticket_kb_links(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_kb_links_article ON ticket_kb_links(article_id);

-- Trigger to update updated_at on tickets.
-- Skriver ISO-8601 (matchar app-kodens new Date().toISOString()) så datumfilter
-- på updated_at träffar exakta gränser. Tidigare CURRENT_TIMESTAMP gav SQLite-
-- format ('YYYY-MM-DD HH:MM:SS') som skiljde sig från app-värdet.
CREATE TRIGGER IF NOT EXISTS update_ticket_updated_at
AFTER UPDATE ON tickets
FOR EACH ROW
BEGIN
  UPDATE tickets SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- Trigger to update updated_at on checklists.
-- Skriver ISO-8601 (matchar app-kodens new Date().toISOString()) så datumfilter
-- på updated_at träffar exakta gränser. Tidigare CURRENT_TIMESTAMP gav SQLite-
-- format ('YYYY-MM-DD HH:MM:SS') som skiljde sig från app-värdet.
CREATE TRIGGER IF NOT EXISTS update_checklist_updated_at
AFTER UPDATE ON ticket_checklists
FOR EACH ROW
BEGIN
  UPDATE ticket_checklists SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- Trigger to update updated_at on comments.
-- Skriver ISO-8601 (matchar app-kodens new Date().toISOString()) så datumfilter
-- på updated_at träffar exakta gränser. Tidigare CURRENT_TIMESTAMP gav SQLite-
-- format ('YYYY-MM-DD HH:MM:SS') som skiljde sig från app-värdet.
CREATE TRIGGER IF NOT EXISTS update_comment_updated_at
AFTER UPDATE ON ticket_comments
FOR EACH ROW
BEGIN
  UPDATE ticket_comments SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- Enrads-konfig (id=1) för det automatiska backup-schemat (paus/tid/retention +
-- senaste-körning-status). Källa till sanning i runtime; seedas av migration 061.
CREATE TABLE IF NOT EXISTS backup_config (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  enabled         INTEGER NOT NULL DEFAULT 1,
  time            TEXT    NOT NULL DEFAULT '04:00',
  retention_days  INTEGER NOT NULL DEFAULT 7,
  last_run_at     TEXT,
  last_status     TEXT,
  last_size_bytes INTEGER,
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
