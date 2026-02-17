-- Migration: Add ticket_comments table
-- Run this inside the Docker container database

-- Create ticket_comments table
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

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_created ON ticket_comments(created_at);

-- Create trigger to auto-update updated_at
CREATE TRIGGER IF NOT EXISTS update_comment_updated_at
AFTER UPDATE ON ticket_comments
FOR EACH ROW
BEGIN
  UPDATE ticket_comments SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
