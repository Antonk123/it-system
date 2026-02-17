PRAGMA foreign_keys=off;
BEGIN TRANSACTION;

ALTER TABLE tickets RENAME TO tickets_old;

CREATE TABLE tickets (
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
  closed_at TEXT
);

INSERT INTO tickets (
  id,
  title,
  description,
  status,
  priority,
  category_id,
  requester_id,
  notes,
  solution,
  created_at,
  updated_at,
  resolved_at,
  closed_at
)
SELECT
  id,
  title,
  description,
  status,
  priority,
  category_id,
  requester_id,
  notes,
  solution,
  created_at,
  updated_at,
  resolved_at,
  closed_at
FROM tickets_old;

DROP TABLE tickets_old;

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_category ON tickets(category_id);
CREATE INDEX IF NOT EXISTS idx_tickets_requester ON tickets(requester_id);

CREATE TRIGGER IF NOT EXISTS update_ticket_updated_at
AFTER UPDATE ON tickets
FOR EACH ROW
BEGIN
  UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

COMMIT;
PRAGMA foreign_keys=on;
