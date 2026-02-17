PRAGMA foreign_keys=off;
BEGIN TRANSACTION;

ALTER TABLE ticket_attachments RENAME TO ticket_attachments_old;
ALTER TABLE ticket_checklists RENAME TO ticket_checklists_old;
ALTER TABLE ticket_comments RENAME TO ticket_comments_old;
ALTER TABLE ticket_shares RENAME TO ticket_shares_old;
ALTER TABLE ticket_links RENAME TO ticket_links_old;

CREATE TABLE ticket_attachments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  file_type TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ticket_checklists (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  completed INTEGER DEFAULT 0,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ticket_comments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_internal INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT DEFAULT NULL
);

CREATE TABLE ticket_shares (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  share_token TEXT UNIQUE NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ticket_links (
  id TEXT PRIMARY KEY,
  source_ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  target_ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  link_type TEXT DEFAULT 'related' CHECK(link_type IN ('related')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO ticket_attachments (
  id, ticket_id, file_name, file_path, file_size, file_type, created_at
)
SELECT
  id, ticket_id, file_name, file_path, file_size, file_type, created_at
FROM ticket_attachments_old;

INSERT INTO ticket_checklists (
  id, ticket_id, label, completed, position, created_at, updated_at
)
SELECT
  id, ticket_id, label, completed, position, created_at, updated_at
FROM ticket_checklists_old;

INSERT INTO ticket_comments (
  id, ticket_id, user_id, content, is_internal, created_at, updated_at, deleted_at
)
SELECT
  id, ticket_id, user_id, content, is_internal, created_at, updated_at, deleted_at
FROM ticket_comments_old;

INSERT INTO ticket_shares (
  id, ticket_id, share_token, created_by, created_at
)
SELECT
  id, ticket_id, share_token, created_by, created_at
FROM ticket_shares_old;

INSERT INTO ticket_links (
  id, source_ticket_id, target_ticket_id, link_type, created_by, created_at
)
SELECT
  id, source_ticket_id, target_ticket_id, link_type, created_by, created_at
FROM ticket_links_old;

DROP TABLE ticket_attachments_old;
DROP TABLE ticket_checklists_old;
DROP TABLE ticket_comments_old;
DROP TABLE ticket_shares_old;
DROP TABLE ticket_links_old;

CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket ON ticket_attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_checklists_ticket ON ticket_checklists(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_created ON ticket_comments(created_at);
CREATE INDEX IF NOT EXISTS idx_ticket_shares_token ON ticket_shares(share_token);
CREATE INDEX IF NOT EXISTS idx_ticket_links_source ON ticket_links(source_ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_links_target ON ticket_links(target_ticket_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_links_unique ON ticket_links(source_ticket_id, target_ticket_id);

CREATE TRIGGER IF NOT EXISTS update_checklist_updated_at
AFTER UPDATE ON ticket_checklists
FOR EACH ROW
BEGIN
  UPDATE ticket_checklists SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_comment_updated_at
AFTER UPDATE ON ticket_comments
FOR EACH ROW
BEGIN
  UPDATE ticket_comments SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

COMMIT;
PRAGMA foreign_keys=on;
