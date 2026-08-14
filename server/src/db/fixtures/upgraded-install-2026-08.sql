-- ═══════════════════════════════════════════════════════════════════════════
-- FRYST ÖGONBLICKSBILD — REDIGERA ALDRIG.
--
-- Schema (DDL, ingen data) från en instans som varit i drift sedan februari
-- 2026 och uppgraderats migration för migration hela vägen till 068. Det är
-- INTE formen dagens schema.sql ger en ny installation: SQLite kan bara lägga
-- till kolumner sist, gamla tabeller behåller kolumner som senare togs ur
-- schema.sql, och index som skapades inuti en columnExists-guard hoppades över
-- på nya installationer.
--
-- schema-path-parity.test.ts kör den här formen genom dagens serverstart
-- (schema.sql + kvarvarande migrationer) och kräver att den landar i exakt
-- samma schema som en fresh install. Nya migrationer prövas därmed mot en
-- verklig uppgraderingsväg, inte bara mot ett tomt skal.
--
-- Filen beskriver ett historiskt tillstånd. Uppdatera den ALDRIG när schema.sql
-- eller migrations.ts ändras — då slutar testet mäta det den finns för.
-- Fångad 2026-08-14.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE ai_deflections (
        id TEXT PRIMARY KEY,
        problem_text TEXT NOT NULL,
        suggestion_text TEXT,
        kb_article_ids TEXT,
        confidence REAL,
        outcome TEXT NOT NULL DEFAULT 'shown' CHECK(outcome IN ('shown','solved','rejected','no_solution')),
        user_email TEXT,
        ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        resolved_at TEXT
      );

CREATE TABLE "ai_usage_log" (
        id TEXT PRIMARY KEY,
        feature TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        ok INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE api_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permissions TEXT DEFAULT '["read"]',
        last_used_at TEXT,
        expires_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        details TEXT,
        ip_address TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      , api_key_id TEXT);

CREATE TABLE backup_config (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  enabled         INTEGER NOT NULL DEFAULT 1,
  time            TEXT    NOT NULL DEFAULT '04:00',
  retention_days  INTEGER NOT NULL DEFAULT 7,
  last_run_at     TEXT,
  last_status     TEXT,
  last_size_bytes INTEGER,
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE billing_rates (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        rate_per_hour REAL NOT NULL,
        currency TEXT DEFAULT 'SEK',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id)
      );

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
, position INTEGER DEFAULT 0);

CREATE TABLE checklist_template_items (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      parent_label TEXT,
      position INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE checklist_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE companies (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          org_number TEXT,
          email TEXT,
          phone TEXT,
          address TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        , sla_disabled INTEGER NOT NULL DEFAULT 0);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
, company_id TEXT REFERENCES companies(id) ON DELETE SET NULL, department TEXT);

CREATE TABLE invoice_lines (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
        time_entry_id TEXT REFERENCES time_entries(id) ON DELETE SET NULL,
        description TEXT NOT NULL,
        hours REAL NOT NULL,
        rate REAL NOT NULL,
        amount REAL NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE invoices (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'paid')),
        total_hours REAL DEFAULT 0,
        total_amount REAL DEFAULT 0,
        currency TEXT DEFAULT 'SEK',
        pdf_path TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        sent_at TEXT,
        paid_at TEXT
      , invoice_number INTEGER, vat_rate REAL NOT NULL DEFAULT 0, vat_amount REAL NOT NULL DEFAULT 0);

CREATE TABLE kb_article_links (
      id TEXT PRIMARY KEY,
      source_article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
      target_article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_article_id, target_article_id)
    );

CREATE TABLE kb_article_shares (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  share_token TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE kb_article_tags (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, tag_id TEXT REFERENCES tags(id) ON DELETE CASCADE,
      UNIQUE(article_id, tag)
    );

CREATE TABLE kb_articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES kb_categories(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
, article_type TEXT CHECK(article_type IN ('how-to', 'solution')), status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft','published')), view_count INTEGER NOT NULL DEFAULT 0, last_reviewed_at TEXT);

CREATE VIRTUAL TABLE kb_articles_fts
        USING fts5(title, content_plain, content='', tokenize='unicode61');

CREATE TABLE kb_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE password_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE push_subscriptions (
      id TEXT PRIMARY KEY,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    , user_id TEXT REFERENCES users(id) ON DELETE CASCADE);

CREATE TABLE recurring_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      tags TEXT DEFAULT '[]',
      interval_type TEXT NOT NULL CHECK(interval_type IN ('daily','weekly','monthly')),
      interval_day INTEGER,
      is_active INTEGER DEFAULT 1,
      last_run TEXT,
      next_run TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE recurring_ticket_history (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES recurring_templates(id) ON DELETE CASCADE,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT DEFAULT CURRENT_TIMESTAMP,
      revoked INTEGER DEFAULT 0
    );

CREATE TABLE schema_migrations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE sla_policies (
        id TEXT PRIMARY KEY,
        company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
        priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high', 'critical')),
        response_time_minutes INTEGER NOT NULL,
        resolution_time_minutes INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, priority)
      );

CREATE TABLE tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '#6366f1',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE template_checklists (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES ticket_templates(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE template_fields (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES ticket_templates(id) ON DELETE CASCADE,
      field_name TEXT NOT NULL,
      field_label TEXT NOT NULL,
      field_type TEXT NOT NULL CHECK(field_type IN ('text', 'textarea', 'number', 'select', 'date', 'checkbox')),
      placeholder TEXT,
      default_value TEXT,
      required INTEGER DEFAULT 0,
      options TEXT,
      position INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

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
, parent_id TEXT REFERENCES ticket_checklists(id) ON DELETE CASCADE, due_date TEXT);

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

CREATE TABLE ticket_field_values (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      field_name TEXT NOT NULL,
      field_label TEXT NOT NULL,
      field_value TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE ticket_history (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      user_id TEXT,
      field_name TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE ticket_kb_links (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ticket_id, article_id)
);

CREATE TABLE ticket_links (
  id TEXT PRIMARY KEY,
  source_ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  target_ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  link_type TEXT DEFAULT 'related' CHECK(link_type IN ('related')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ticket_reminders (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_time TEXT NOT NULL,
  message TEXT,
  sent INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT DEFAULT NULL
);

CREATE TABLE ticket_shares (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  share_token TEXT UNIQUE NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
, expires_at TEXT);

CREATE TABLE ticket_tags (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(ticket_id, tag_id)
      );

CREATE TABLE "ticket_templates" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      template_type TEXT DEFAULT 'standard' CHECK(template_type IN ('standard', 'dynamic')),
      title_template TEXT NOT NULL,
      description_template TEXT,
      priority TEXT DEFAULT 'medium',
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      notes_template TEXT,
      solution_template TEXT,
      position INTEGER DEFAULT 0,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

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
, template_id TEXT, company_id TEXT REFERENCES companies(id) ON DELETE SET NULL, assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL, sla_response_deadline TEXT, sla_resolution_deadline TEXT, sla_paused_at TEXT, sla_paused_duration INTEGER DEFAULT 0, sla_response_met INTEGER, sla_resolution_met INTEGER, ai_suggested_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL, ai_suggested_confidence REAL, ai_draft_response TEXT, ai_draft_updated_at TEXT, ai_summary_json TEXT, ai_summary_updated_at TEXT, email_message_id TEXT, last_aging_notified_at TEXT, created_by TEXT REFERENCES users(id) ON DELETE SET NULL);

CREATE VIRTUAL TABLE tickets_fts USING fts5(
        title, description, notes, solution,
        content='', contentless_delete=1
      );

CREATE TABLE time_entries (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      duration_minutes INTEGER NOT NULL CHECK(duration_minutes > 0),
      note TEXT CHECK(note IS NULL OR length(note) <= 500),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    , user_id TEXT REFERENCES users(id) ON DELETE SET NULL, billable INTEGER NOT NULL DEFAULT 1, work_date TEXT, invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_login TEXT
, display_name TEXT, oidc_sub TEXT, oidc_iss TEXT);

CREATE TABLE webhook_deliveries (
        id TEXT PRIMARY KEY,
        webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
        event TEXT NOT NULL,
        payload TEXT NOT NULL,
        response_code INTEGER,
        attempts INTEGER DEFAULT 0,
        delivered_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      , next_retry_at TEXT, last_error TEXT);

CREATE TABLE webhooks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        events TEXT NOT NULL DEFAULT '[]',
        secret TEXT NOT NULL,
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_triggered_at TEXT
      );

CREATE INDEX idx_ai_deflections_created ON ai_deflections(created_at DESC);

CREATE INDEX idx_ai_deflections_outcome ON ai_deflections(outcome);

CREATE INDEX idx_ai_usage_log_created ON ai_usage_log(created_at DESC);

CREATE INDEX idx_ai_usage_log_feature ON ai_usage_log(feature);

CREATE INDEX idx_ai_usage_log_ticket ON ai_usage_log(ticket_id);

CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);

CREATE INDEX idx_api_keys_user ON api_keys(user_id);

CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);

CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);

CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);

CREATE INDEX idx_billing_rates_company ON billing_rates(company_id);

CREATE INDEX idx_categories_position ON categories(position);

CREATE INDEX idx_checklist_template_items_template ON checklist_template_items(template_id);

CREATE INDEX idx_checklist_templates_name ON checklist_templates(name);

CREATE INDEX idx_companies_name ON companies(name);

CREATE INDEX idx_contacts_company ON contacts(company_id);

CREATE INDEX idx_contacts_email ON contacts(email);

CREATE INDEX idx_invoice_lines_invoice ON invoice_lines(invoice_id);

CREATE INDEX idx_invoice_lines_ticket ON invoice_lines(ticket_id);

CREATE INDEX idx_invoice_lines_time_entry ON invoice_lines(time_entry_id);

CREATE INDEX idx_invoices_company ON invoices(company_id);

CREATE UNIQUE INDEX idx_invoices_invoice_number ON invoices(invoice_number) WHERE invoice_number IS NOT NULL;

CREATE INDEX idx_invoices_status ON invoices(status);

CREATE INDEX idx_kb_article_links_source ON kb_article_links(source_article_id);

CREATE INDEX idx_kb_article_links_target ON kb_article_links(target_article_id);

CREATE INDEX idx_kb_article_shares_article ON kb_article_shares(article_id);

CREATE INDEX idx_kb_article_shares_token ON kb_article_shares(share_token);

CREATE INDEX idx_kb_article_tags_article ON kb_article_tags(article_id);

CREATE INDEX idx_kb_article_tags_tag ON kb_article_tags(tag);

CREATE INDEX idx_kb_article_tags_tag_id ON kb_article_tags(tag_id);

CREATE INDEX idx_kb_articles_category ON kb_articles(category_id);

CREATE INDEX idx_kb_articles_last_reviewed ON kb_articles(last_reviewed_at);

CREATE INDEX idx_kb_articles_status_updated ON kb_articles(status, updated_at DESC);

CREATE INDEX idx_kb_articles_updated ON kb_articles(updated_at);

CREATE INDEX idx_password_reset_expires ON password_reset_tokens(expires_at);

CREATE INDEX idx_password_reset_token_hash ON password_reset_tokens(token_hash);

CREATE INDEX idx_password_reset_user ON password_reset_tokens(user_id);

CREATE INDEX idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);

CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);

CREATE INDEX idx_recurring_history_template ON recurring_ticket_history(template_id, created_at DESC);

CREATE INDEX idx_recurring_templates_next_run ON recurring_templates(is_active, next_run);

CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);

CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

CREATE INDEX idx_sla_policies_company ON sla_policies(company_id);

CREATE INDEX idx_template_checklists_template ON template_checklists(template_id);

CREATE INDEX idx_template_fields_position ON template_fields(position);

CREATE INDEX idx_template_fields_template ON template_fields(template_id);

CREATE INDEX idx_ticket_attachments_ticket ON ticket_attachments(ticket_id);

CREATE INDEX idx_ticket_checklists_parent ON ticket_checklists(parent_id);

CREATE INDEX idx_ticket_checklists_ticket ON ticket_checklists(ticket_id);

CREATE INDEX idx_ticket_comments_created ON ticket_comments(created_at);

CREATE INDEX idx_ticket_comments_ticket ON ticket_comments(ticket_id);

CREATE INDEX idx_ticket_comments_user ON ticket_comments(user_id);

CREATE INDEX idx_ticket_field_values_field ON ticket_field_values(field_name);

CREATE INDEX idx_ticket_field_values_search ON ticket_field_values(field_name, field_value);

CREATE INDEX idx_ticket_field_values_ticket ON ticket_field_values(ticket_id);

CREATE UNIQUE INDEX idx_ticket_field_values_unique ON ticket_field_values(ticket_id, field_name);

CREATE INDEX idx_ticket_history_changed ON ticket_history(changed_at);

CREATE INDEX idx_ticket_history_ticket ON ticket_history(ticket_id);

CREATE INDEX idx_ticket_history_user ON ticket_history(user_id);

CREATE INDEX idx_ticket_kb_links_article ON ticket_kb_links(article_id);

CREATE INDEX idx_ticket_kb_links_ticket ON ticket_kb_links(ticket_id);

CREATE INDEX idx_ticket_links_source ON ticket_links(source_ticket_id);

CREATE INDEX idx_ticket_links_target ON ticket_links(target_ticket_id);

CREATE UNIQUE INDEX idx_ticket_links_unique ON ticket_links(source_ticket_id, target_ticket_id);

CREATE INDEX idx_ticket_reminders_sent ON ticket_reminders(sent);

CREATE INDEX idx_ticket_reminders_ticket ON ticket_reminders(ticket_id);

CREATE INDEX idx_ticket_reminders_time ON ticket_reminders(reminder_time);

CREATE INDEX idx_ticket_reminders_user ON ticket_reminders(user_id);

CREATE INDEX idx_ticket_shares_token ON ticket_shares(share_token);

CREATE INDEX idx_ticket_tags_tag ON ticket_tags(tag_id);

CREATE INDEX idx_ticket_tags_ticket ON ticket_tags(ticket_id);

CREATE INDEX idx_ticket_templates_position ON ticket_templates(position);

CREATE INDEX idx_tickets_assigned ON tickets(assigned_to);

CREATE INDEX idx_tickets_category ON tickets(category_id);

CREATE INDEX idx_tickets_closed_at ON tickets(status, closed_at DESC);

CREATE INDEX idx_tickets_company ON tickets(company_id);

CREATE INDEX idx_tickets_created_at ON tickets(created_at);

CREATE INDEX idx_tickets_created_by ON tickets(created_by);

CREATE INDEX idx_tickets_email_message_id ON tickets(email_message_id);

CREATE INDEX idx_tickets_priority ON tickets(priority);

CREATE INDEX idx_tickets_requester ON tickets(requester_id);

CREATE INDEX idx_tickets_sla_resolution ON tickets(sla_resolution_deadline);

CREATE INDEX idx_tickets_sla_response ON tickets(sla_response_deadline);

CREATE INDEX idx_tickets_status ON tickets(status);

CREATE INDEX idx_tickets_status_priority ON tickets(status, priority);

CREATE INDEX idx_tickets_status_updated ON tickets(status, updated_at DESC);

CREATE INDEX idx_tickets_updated_at ON tickets(updated_at);

CREATE INDEX idx_time_entries_created ON time_entries(created_at DESC);

CREATE INDEX idx_time_entries_ticket ON time_entries(ticket_id);

CREATE INDEX idx_time_entries_user ON time_entries(user_id);

CREATE INDEX idx_users_email ON users(email);

CREATE UNIQUE INDEX idx_users_oidc_identity ON users(oidc_iss, oidc_sub) WHERE oidc_sub IS NOT NULL;

CREATE INDEX idx_webhook_deliveries_created ON webhook_deliveries(created_at);

CREATE INDEX idx_webhook_deliveries_retry ON webhook_deliveries(delivered_at, next_retry_at, attempts);

CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);

CREATE TRIGGER tickets_fts_ad
        AFTER DELETE ON tickets FOR EACH ROW BEGIN
          DELETE FROM tickets_fts WHERE rowid = OLD.rowid;
        END;

CREATE TRIGGER tickets_fts_ai
        AFTER INSERT ON tickets FOR EACH ROW BEGIN
          INSERT INTO tickets_fts(rowid, title, description, notes, solution)
          VALUES (NEW.rowid, NEW.title, COALESCE(NEW.description, ''), COALESCE(NEW.notes, ''), COALESCE(NEW.solution, ''));
        END;

CREATE TRIGGER tickets_fts_au
        AFTER UPDATE OF title, description, notes, solution ON tickets FOR EACH ROW BEGIN
          DELETE FROM tickets_fts WHERE rowid = OLD.rowid;
          INSERT INTO tickets_fts(rowid, title, description, notes, solution)
          VALUES (NEW.rowid, NEW.title, COALESCE(NEW.description, ''), COALESCE(NEW.notes, ''), COALESCE(NEW.solution, ''));
        END;

CREATE TRIGGER update_checklist_updated_at
        AFTER UPDATE ON ticket_checklists FOR EACH ROW BEGIN
          UPDATE ticket_checklists SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
        END;

CREATE TRIGGER update_comment_updated_at
        AFTER UPDATE ON ticket_comments FOR EACH ROW BEGIN
          UPDATE ticket_comments SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
        END;

CREATE TRIGGER update_ticket_updated_at
        AFTER UPDATE ON tickets FOR EACH ROW BEGIN
          UPDATE tickets SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
        END;

-- Migrationer som redan var applicerade när ögonblicksbilden togs. Utan dem
-- skulle testet köra om alla 68 mot en databas som redan har dem — inte det
-- prods nästa start gör.
INSERT INTO schema_migrations (id, name, applied_at) VALUES
  ('001', 'ensure_ticket_attachments_table', '2026-08-14T00:00:00.000Z'),
  ('002', 'ensure_ticket_comments_table', '2026-08-14T00:00:00.000Z'),
  ('003', 'ensure_category_position_column', '2026-08-14T00:00:00.000Z'),
  ('004', 'ensure_ticket_template_id_column', '2026-08-14T00:00:00.000Z'),
  ('005', 'ensure_ticket_templates_table', '2026-08-14T00:00:00.000Z'),
  ('006', 'ensure_template_checklists_table', '2026-08-14T00:00:00.000Z'),
  ('007', 'ensure_template_fields_table', '2026-08-14T00:00:00.000Z'),
  ('008', 'ensure_default_templates_removed', '2026-08-14T00:00:00.000Z'),
  ('009', 'ensure_ticket_field_values_table', '2026-08-14T00:00:00.000Z'),
  ('010', 'ensure_ticket_history_table', '2026-08-14T00:00:00.000Z'),
  ('011', 'ensure_ticket_reminders_table', '2026-08-14T00:00:00.000Z'),
  ('012', 'ensure_checklist_extensions', '2026-08-14T00:00:00.000Z'),
  ('013', 'ensure_checklist_templates_table', '2026-08-14T00:00:00.000Z'),
  ('014', 'ensure_kb_fts5_and_type', '2026-08-14T00:00:00.000Z'),
  ('015', 'ensure_kb_v2_columns', '2026-08-14T00:00:00.000Z'),
  ('016', 'ensure_kb_article_tags_table', '2026-08-14T00:00:00.000Z'),
  ('017', 'ensure_kb_article_tags_use_shared_tags', '2026-08-14T00:00:00.000Z'),
  ('018', 'ensure_kb_review_column', '2026-08-14T00:00:00.000Z'),
  ('019', 'ensure_recurring_templates_table', '2026-08-14T00:00:00.000Z'),
  ('020', 'ensure_kb_article_links_table', '2026-08-14T00:00:00.000Z'),
  ('021', 'ensure_time_entries_table', '2026-08-14T00:00:00.000Z'),
  ('022', 'ensure_push_subscriptions_table', '2026-08-14T00:00:00.000Z'),
  ('023', 'ensure_tickets_closed_at_index', '2026-08-14T00:00:00.000Z'),
  ('024', 'ensure_kb_articles_have_category', '2026-08-14T00:00:00.000Z'),
  ('025', 'ensure_kb_articles_have_category', '2026-08-14T00:00:00.000Z'),
  ('026', 'create_refresh_tokens_table', '2026-08-14T00:00:00.000Z'),
  ('027', 'ensure_tickets_fts5_exists', '2026-08-14T00:00:00.000Z'),
  ('028', 'create_companies_table_and_migrate_contacts', '2026-08-14T00:00:00.000Z'),
  ('029', 'add_company_id_and_assigned_to_on_tickets', '2026-08-14T00:00:00.000Z'),
  ('030', 'create_sla_policies_table', '2026-08-14T00:00:00.000Z'),
  ('031', 'add_sla_columns_to_tickets', '2026-08-14T00:00:00.000Z'),
  ('032', 'create_billing_rates_table', '2026-08-14T00:00:00.000Z'),
  ('033', 'create_invoices_tables', '2026-08-14T00:00:00.000Z'),
  ('034', 'create_api_keys_table', '2026-08-14T00:00:00.000Z'),
  ('035', 'create_webhooks_tables', '2026-08-14T00:00:00.000Z'),
  ('036', 'add_department_to_contacts', '2026-08-14T00:00:00.000Z'),
  ('037', 'add_ai_columns_and_usage_log', '2026-08-14T00:00:00.000Z'),
  ('038', 'add_ai_deflections_table', '2026-08-14T00:00:00.000Z'),
  ('039', 'fix_ai_usage_log_feature_check', '2026-08-14T00:00:00.000Z'),
  ('040', 'add_email_message_id_to_tickets', '2026-08-14T00:00:00.000Z'),
  ('041', 'create_password_reset_tokens_table', '2026-08-14T00:00:00.000Z'),
  ('042', 'seed_default_sla_policies', '2026-08-14T00:00:00.000Z'),
  ('043', 'webhook_delivery_retry_columns', '2026-08-14T00:00:00.000Z'),
  ('044', 'add_last_aging_notified_at_to_tickets', '2026-08-14T00:00:00.000Z'),
  ('045', 'add_sla_disabled_to_companies', '2026-08-14T00:00:00.000Z'),
  ('046', 'add_template_type_column', '2026-08-14T00:00:00.000Z'),
  ('047', 'seed_dynamic_template_fields', '2026-08-14T00:00:00.000Z'),
  ('048', 'fix_sla_policies_company_id_data', '2026-08-14T00:00:00.000Z'),
  ('049', 'add_user_id_to_time_entries', '2026-08-14T00:00:00.000Z'),
  ('050', 'add_fts5_auto_sync_triggers', '2026-08-14T00:00:00.000Z'),
  ('051', 'create_audit_log_table', '2026-08-14T00:00:00.000Z'),
  ('052', 'rebuild_fts5_index', '2026-08-14T00:00:00.000Z'),
  ('053', 'add_index_tickets_created_at', '2026-08-14T00:00:00.000Z'),
  ('054', 'add_missing_fk_indexes', '2026-08-14T00:00:00.000Z'),
  ('055', 'add_user_id_to_push_subscriptions', '2026-08-14T00:00:00.000Z'),
  ('056', 'add_webhook_delivery_cleanup_index', '2026-08-14T00:00:00.000Z'),
  ('057', 'fix_fts5_contentless_delete_triggers', '2026-08-14T00:00:00.000Z'),
  ('058', 'add_tickets_created_by_and_updated_at_index', '2026-08-14T00:00:00.000Z'),
  ('059', 'fix_updated_at_trigger_iso_and_refresh_token_drift', '2026-08-14T00:00:00.000Z'),
  ('060', 'fix_checklist_and_comment_updated_at_trigger_iso', '2026-08-14T00:00:00.000Z'),
  ('061', 'create_backup_config', '2026-08-14T00:00:00.000Z'),
  ('062', 'composite_indexes_and_fts5_delete_trigger_consistency', '2026-08-14T00:00:00.000Z'),
  ('063', 'invoice_authenticity_and_time_fields', '2026-08-14T00:00:00.000Z'),
  ('064', 'create_app_settings', '2026-08-14T00:00:00.000Z'),
  ('065', 'add_users_oidc_sub', '2026-08-14T00:00:00.000Z'),
  ('066', 'add_audit_log_api_key_id', '2026-08-14T00:00:00.000Z'),
  ('067', 'add_ticket_shares_expires_at', '2026-08-14T00:00:00.000Z'),
  ('068', 'add_users_oidc_iss', '2026-08-14T00:00:00.000Z');
