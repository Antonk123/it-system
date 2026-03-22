# Checklist Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add checklist templates, sub-checklists (one level), and per-item deadlines to the IT ticket system.

**Architecture:** Additive DB changes via `ensureXxx()` guards in `connection.ts`; new standalone `checklist_templates` + `checklist_template_items` tables; new Express route file for templates; frontend enhancements to `TicketChecklist.tsx` and Settings.

**Tech Stack:** better-sqlite3, Express/TypeScript, React + TypeScript, Zod, Sonner toasts, shadcn/ui, Lucide icons, date-fns

---

## Files to Create
- `server/src/routes/checklistTemplates.ts` — CRUD + apply-to-ticket endpoint
- `src/hooks/useChecklistTemplates.ts` — React hook for template operations
- `src/components/ChecklistTemplateModal.tsx` — "Välj mall" modal

## Files to Modify
- `server/src/db/connection.ts` — add `ensureChecklistExtensions()` (parent_id, due_date columns + new tables)
- `server/src/index.ts` — register new route
- `server/src/routes/checklists.ts` — support parent_id + due_date in GET/POST/PUT
- `src/lib/api.ts` — add template API methods
- `src/hooks/useTicketChecklists.ts` — extend ChecklistItem type (parent_id, due_date), update hook methods
- `src/components/TicketChecklist.tsx` — sub-items, due dates, "Välj mall" + "Spara som mall"
- `src/pages/Settings.tsx` — add Checklist Templates section

---

## Task 1: DB migrations — parent_id + due_date on ticket_checklists

**Files:**
- Modify: `server/src/db/connection.ts`

- [ ] Open `connection.ts` and add a new `ensureChecklistExtensions()` function after `ensureTicketRemindersTable()`:

```typescript
const ensureChecklistExtensions = () => {
  if (!tableExists('ticket_checklists')) return;
  if (!columnExists('ticket_checklists', 'parent_id')) {
    db.exec('ALTER TABLE ticket_checklists ADD COLUMN parent_id TEXT REFERENCES ticket_checklists(id) ON DELETE CASCADE;');
    console.log('Added parent_id column to ticket_checklists');
  }
  if (!columnExists('ticket_checklists', 'due_date')) {
    db.exec('ALTER TABLE ticket_checklists ADD COLUMN due_date TEXT;');
    console.log('Added due_date column to ticket_checklists');
  }
};
```

- [ ] Add `ensureChecklistExtensions();` call inside `initializeDatabase()` (after `ensureTicketRemindersTable()`)

- [ ] Commit:
```bash
git add server/src/db/connection.ts
git commit -m "feat: add parent_id and due_date columns to ticket_checklists"
```

---

## Task 2: DB migrations — checklist_templates tables

**Files:**
- Modify: `server/src/db/connection.ts`

- [ ] Add `ensureChecklistTemplatesTable()` function in `connection.ts`:

```typescript
const ensureChecklistTemplatesTable = () => {
  if (!tableExists('checklist_templates')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS checklist_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS checklist_template_items (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        parent_label TEXT,
        position INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_checklist_templates_name ON checklist_templates(name);
      CREATE INDEX IF NOT EXISTS idx_checklist_template_items_template ON checklist_template_items(template_id);
    `);
    console.log('Created checklist_templates and checklist_template_items tables');
  }
};
```

- [ ] Add `ensureChecklistTemplatesTable();` call inside `initializeDatabase()`

- [ ] Commit:
```bash
git add server/src/db/connection.ts
git commit -m "feat: add checklist_templates and checklist_template_items tables"
```

---

## Task 3: Backend route — checklist templates CRUD

**Files:**
- Create: `server/src/routes/checklistTemplates.ts`

- [ ] Create the file with the following content:

```typescript
import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface TemplateItemRow {
  id: string;
  template_id: string;
  label: string;
  parent_label: string | null;
  position: number;
}

// GET /api/checklist-templates — list all templates with items
router.get('/', authenticate, (_req: AuthRequest, res: Response) => {
  try {
    const templates = db.prepare('SELECT * FROM checklist_templates ORDER BY name ASC').all() as TemplateRow[];
    const items = db.prepare('SELECT * FROM checklist_template_items ORDER BY position ASC').all() as TemplateItemRow[];
    const result = templates.map(t => ({
      ...t,
      items: items.filter(i => i.template_id === t.id),
    }));
    res.json(result);
  } catch (error) {
    console.error('Error fetching checklist templates:', error);
    res.status(500).json({ error: 'Failed to fetch checklist templates' });
  }
});

// POST /api/checklist-templates — create template
router.post('/', authenticate, (req: AuthRequest, res: Response) => {
  const { name, description, items } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required' });
  }
  try {
    const id = uuidv4();
    db.prepare('INSERT INTO checklist_templates (id, name, description) VALUES (?, ?, ?)').run(id, name.trim(), description?.trim() || null);
    const insertItem = db.prepare('INSERT INTO checklist_template_items (id, template_id, label, parent_label, position) VALUES (?, ?, ?, ?, ?)');
    const insertAll = db.transaction((rows: { label: string; parent_label?: string }[]) => {
      rows.forEach((row, i) => {
        insertItem.run(uuidv4(), id, row.label.trim(), row.parent_label?.trim() || null, i);
      });
    });
    insertAll(items.filter((i: any) => typeof i.label === 'string' && i.label.trim().length > 0));
    const template = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(id) as TemplateRow;
    const templateItems = db.prepare('SELECT * FROM checklist_template_items WHERE template_id = ? ORDER BY position ASC').all(id) as TemplateItemRow[];
    res.status(201).json({ ...template, items: templateItems });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'A template with that name already exists' });
    }
    console.error('Error creating checklist template:', error);
    res.status(500).json({ error: 'Failed to create checklist template' });
  }
});

// PUT /api/checklist-templates/:id — update template
router.put('/:id', authenticate, (req: AuthRequest, res: Response) => {
  const { name, description, items } = req.body;
  try {
    const existing = db.prepare('SELECT id FROM checklist_templates WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Template not found' });
    if (name !== undefined) {
      db.prepare('UPDATE checklist_templates SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name.trim(), description?.trim() || null, req.params.id);
    }
    if (Array.isArray(items)) {
      db.prepare('DELETE FROM checklist_template_items WHERE template_id = ?').run(req.params.id);
      const insertItem = db.prepare('INSERT INTO checklist_template_items (id, template_id, label, parent_label, position) VALUES (?, ?, ?, ?, ?)');
      const insertAll = db.transaction((rows: { label: string; parent_label?: string }[]) => {
        rows.forEach((row, i) => {
          insertItem.run(uuidv4(), req.params.id, row.label.trim(), row.parent_label?.trim() || null, i);
        });
      });
      insertAll(items.filter((i: any) => typeof i.label === 'string' && i.label.trim().length > 0));
    }
    const template = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(req.params.id) as TemplateRow;
    const templateItems = db.prepare('SELECT * FROM checklist_template_items WHERE template_id = ? ORDER BY position ASC').all(req.params.id) as TemplateItemRow[];
    res.json({ ...template, items: templateItems });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'A template with that name already exists' });
    }
    console.error('Error updating checklist template:', error);
    res.status(500).json({ error: 'Failed to update checklist template' });
  }
});

// DELETE /api/checklist-templates/:id
router.delete('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const result = db.prepare('DELETE FROM checklist_templates WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Template not found' });
    res.json({ message: 'Template deleted' });
  } catch (error) {
    console.error('Error deleting checklist template:', error);
    res.status(500).json({ error: 'Failed to delete checklist template' });
  }
});

// POST /api/checklist-templates/:id/apply — apply template to a ticket
router.post('/:id/apply', authenticate, (req: AuthRequest, res: Response) => {
  const { ticketId } = req.body;
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  try {
    const ticket = db.prepare('SELECT id FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const template = db.prepare('SELECT id FROM checklist_templates WHERE id = ?').get(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const templateItems = db.prepare('SELECT * FROM checklist_template_items WHERE template_id = ? ORDER BY position ASC').all(req.params.id) as TemplateItemRow[];

    // Get current max position
    const maxPos = db.prepare('SELECT MAX(position) as mp FROM ticket_checklists WHERE ticket_id = ?').get(ticketId) as { mp: number | null };
    let pos = (maxPos.mp ?? -1) + 1;

    // Insert parent items first, track label→id mapping for nesting
    const labelToId: Record<string, string> = {};
    const parentItems = templateItems.filter(i => !i.parent_label);
    const insertItem = db.prepare('INSERT INTO ticket_checklists (id, ticket_id, label, position, parent_id) VALUES (?, ?, ?, ?, ?)');

    const doInsert = db.transaction(() => {
      for (const item of parentItems) {
        const newId = uuidv4();
        insertItem.run(newId, ticketId, item.label, pos++, null);
        labelToId[item.label] = newId;
      }
      for (const item of templateItems.filter(i => i.parent_label)) {
        const parentId = labelToId[item.parent_label!] || null;
        insertItem.run(uuidv4(), ticketId, item.label, pos++, parentId);
      }
    });
    doInsert();

    interface ChecklistRow { id: string; ticket_id: string; label: string; completed: number; position: number; parent_id: string | null; due_date: string | null; created_at: string; updated_at: string; }
    const created = db.prepare('SELECT * FROM ticket_checklists WHERE ticket_id = ? ORDER BY position ASC').all(ticketId) as ChecklistRow[];
    res.status(201).json(created.map(r => ({ ...r, completed: r.completed === 1 })));
  } catch (error) {
    console.error('Error applying checklist template:', error);
    res.status(500).json({ error: 'Failed to apply template' });
  }
});

export default router;
```

- [ ] Register in `server/src/index.ts` — add import and mount:
```typescript
import checklistTemplateRoutes from './routes/checklistTemplates.js';
// ...
app.use('/api/checklist-templates', checklistTemplateRoutes);
```

- [ ] Commit:
```bash
git add server/src/routes/checklistTemplates.ts server/src/index.ts
git commit -m "feat: add checklist templates CRUD and apply-to-ticket route"
```

---

## Task 4: Update checklist route to support parent_id + due_date

**Files:**
- Modify: `server/src/routes/checklists.ts`

- [ ] Update `ChecklistRow` interface to include new fields:
```typescript
interface ChecklistRow {
  id: string;
  ticket_id: string;
  label: string;
  completed: number;
  position: number;
  parent_id: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] Update GET handler — the `SELECT *` already fetches new columns, but update the map to include them:
```typescript
const mapped = items.map(item => ({
  ...item,
  completed: item.completed === 1,
}));
```
(No change needed — spread handles it.)

- [ ] Update POST `/ticket/:ticketId` to accept optional `parent_id` and `due_date`:
```typescript
const { label, parent_id, due_date } = req.body;
// ...
db.prepare(`
  INSERT INTO ticket_checklists (id, ticket_id, label, position, parent_id, due_date)
  VALUES (?, ?, ?, ?, ?, ?)
`).run(id, req.params.ticketId, label.trim(), position, parent_id || null, due_date || null);
```

- [ ] Update POST `/ticket/:ticketId/bulk` — add `parent_id` and `due_date` params (items can be objects `{label, parent_id?, due_date?}`). Keep backwards compat with plain strings by checking type.

- [ ] Update PUT `/:id` to accept `due_date` and `parent_id` in updates:
```typescript
const { label, completed, due_date, parent_id } = req.body;
// ...add to the updates array as for label/completed
if (due_date !== undefined) {
  updates.push('due_date = ?');
  values.push(due_date);
}
if (parent_id !== undefined) {
  updates.push('parent_id = ?');
  values.push(parent_id);
}
```

- [ ] Commit:
```bash
git add server/src/routes/checklists.ts
git commit -m "feat: support parent_id and due_date in checklist CRUD endpoints"
```

---

## Task 5: Frontend — API client + types

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src/hooks/useTicketChecklists.ts`

- [ ] In `src/lib/api.ts`, extend `ChecklistRow` interface:
```typescript
export interface ChecklistRow {
  id: string;
  ticket_id: string;
  label: string;
  completed: boolean;
  position: number;
  parent_id: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] Add template-related interfaces and methods to `ApiClient` in `api.ts`:
```typescript
export interface ChecklistTemplateItem {
  id: string;
  template_id: string;
  label: string;
  parent_label: string | null;
  position: number;
}
export interface ChecklistTemplate {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  items: ChecklistTemplateItem[];
}

// Inside class ApiClient:
async getChecklistTemplates(): Promise<ChecklistTemplate[]> {
  return this.request<ChecklistTemplate[]>('/checklist-templates');
}
async createChecklistTemplate(data: { name: string; description?: string; items: { label: string; parent_label?: string }[] }): Promise<ChecklistTemplate> {
  return this.request<ChecklistTemplate>('/checklist-templates', { method: 'POST', body: data });
}
async updateChecklistTemplate(id: string, data: { name?: string; description?: string; items?: { label: string; parent_label?: string }[] }): Promise<ChecklistTemplate> {
  return this.request<ChecklistTemplate>(`/checklist-templates/${id}`, { method: 'PUT', body: data });
}
async deleteChecklistTemplate(id: string): Promise<{ message: string }> {
  return this.request<{ message: string }>(`/checklist-templates/${id}`, { method: 'DELETE' });
}
async applyChecklistTemplate(templateId: string, ticketId: string): Promise<ChecklistRow[]> {
  return this.request<ChecklistRow[]>(`/checklist-templates/${templateId}/apply`, { method: 'POST', body: { ticketId } });
}
```

- [ ] Update `ChecklistItem` in `src/hooks/useTicketChecklists.ts`:
```typescript
export interface ChecklistItem {
  id: string;
  ticket_id: string;
  label: string;
  completed: boolean;
  position: number;
  parent_id: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] Update `updateChecklistItem` to support `due_date` and `parent_id`:
```typescript
async (id: string, updates: Partial<Pick<ChecklistItem, 'label' | 'completed' | 'due_date' | 'parent_id'>>) => { ... }
```

- [ ] Commit:
```bash
git add src/lib/api.ts src/hooks/useTicketChecklists.ts
git commit -m "feat: extend ChecklistItem and ApiClient with parent_id, due_date, and template methods"
```

---

## Task 6: Frontend hook — useChecklistTemplates

**Files:**
- Create: `src/hooks/useChecklistTemplates.ts`

- [ ] Create the hook:
```typescript
import { useState, useCallback } from 'react';
import { api, ChecklistTemplate } from '@/lib/api';
import { toast } from 'sonner';

export const useChecklistTemplates = () => {
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.getChecklistTemplates();
      setTemplates(data);
    } catch { toast.error('Kunde inte hämta checklistmallar'); }
    finally { setIsLoading(false); }
  }, []);

  const createTemplate = useCallback(async (data: { name: string; description?: string; items: { label: string; parent_label?: string }[] }) => {
    try {
      const t = await api.createChecklistTemplate(data);
      setTemplates(prev => [...prev, t]);
      toast.success('Mall skapad');
      return t;
    } catch (e: any) {
      toast.error(e.message?.includes('already exists') ? 'En mall med det namnet finns redan' : 'Kunde inte skapa mall');
      return null;
    }
  }, []);

  const updateTemplate = useCallback(async (id: string, data: Parameters<typeof api.updateChecklistTemplate>[1]) => {
    try {
      const t = await api.updateChecklistTemplate(id, data);
      setTemplates(prev => prev.map(x => x.id === id ? t : x));
      toast.success('Mall uppdaterad');
      return t;
    } catch { toast.error('Kunde inte uppdatera mall'); return null; }
  }, []);

  const deleteTemplate = useCallback(async (id: string) => {
    try {
      await api.deleteChecklistTemplate(id);
      setTemplates(prev => prev.filter(x => x.id !== id));
      toast.success('Mall borttagen');
    } catch { toast.error('Kunde inte ta bort mall'); }
  }, []);

  const applyTemplate = useCallback(async (templateId: string, ticketId: string) => {
    try {
      const items = await api.applyChecklistTemplate(templateId, ticketId);
      toast.success('Mall applicerad');
      return items;
    } catch { toast.error('Kunde inte applicera mall'); return null; }
  }, []);

  return { templates, isLoading, fetchTemplates, createTemplate, updateTemplate, deleteTemplate, applyTemplate };
};
```

- [ ] Commit:
```bash
git add src/hooks/useChecklistTemplates.ts
git commit -m "feat: add useChecklistTemplates hook"
```

---

## Task 7: Frontend — ChecklistTemplateModal

**Files:**
- Create: `src/components/ChecklistTemplateModal.tsx`

- [ ] Create a modal that lists available templates and lets user select one to apply. UI pattern follows other modals in the codebase (Dialog from shadcn/ui):

```typescript
import { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChecklistTemplate } from '@/lib/api';
import { ListChecks, ChevronRight } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  templates: ChecklistTemplate[];
  onSelect: (template: ChecklistTemplate) => void;
}

export const ChecklistTemplateModal = ({ open, onClose, templates, onSelect }: Props) => {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            Välj checklistmall
          </DialogTitle>
        </DialogHeader>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Inga mallar skapade ännu. Gå till Inställningar för att skapa mallar.</p>
        ) : (
          <div className="space-y-2 py-2">
            {templates.map(t => (
              <button
                key={t.id}
                onClick={() => { onSelect(t); onClose(); }}
                className="w-full text-left px-4 py-3 rounded-lg border hover:bg-muted/50 transition-colors flex items-center justify-between group"
              >
                <div>
                  <div className="font-medium text-sm">{t.name}</div>
                  {t.description && <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>}
                  <div className="text-xs text-muted-foreground mt-1">{t.items.length} punkt{t.items.length !== 1 ? 'er' : ''}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
```

- [ ] Commit:
```bash
git add src/components/ChecklistTemplateModal.tsx
git commit -m "feat: add ChecklistTemplateModal component"
```

---

## Task 8: Update TicketChecklist.tsx — sub-items, due dates, template actions

**Files:**
- Modify: `src/components/TicketChecklist.tsx`

This is the largest change. Replace the file with the updated version:

- [ ] Update imports to include new icons and components:
```typescript
import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { X, Plus, CheckSquare, ChevronDown, ChevronRight, Calendar, ListChecks, Bookmark } from 'lucide-react';
import { ChecklistItem } from '@/hooks/useTicketChecklists';
import { ChecklistTemplate } from '@/lib/api';
import { ChecklistTemplateModal } from './ChecklistTemplateModal';
import { format, parseISO, isPast } from 'date-fns';
import { sv } from 'date-fns/locale';
```

- [ ] Update the `TicketChecklistProps` interface:
```typescript
interface TicketChecklistProps {
  items: ChecklistItem[];
  pendingItems?: PendingItem[];
  onToggle?: (id: string, completed: boolean) => void;
  onDelete?: (id: string) => void;
  onAdd?: (label: string, parentId?: string | null) => void;
  onUpdate?: (id: string, updates: Partial<Pick<ChecklistItem, 'label' | 'due_date'>>) => void;
  onPendingAdd?: (label: string) => void;
  onPendingDelete?: (id: string) => void;
  readOnly?: boolean;
  templates?: ChecklistTemplate[];
  onApplyTemplate?: (template: ChecklistTemplate) => void;
  onSaveAsTemplate?: (items: ChecklistItem[]) => void;
}
```

- [ ] Implement the component body:
  - Render top-level items (parent_id === null) first
  - Under each parent, render its children indented
  - Each item shows: checkbox, label, optional due-date badge (red if past), date-picker button on hover, delete button on hover
  - "Add sub-item" button (+ indent icon) appears on hover of a parent item
  - Header area shows "Välj mall" and "Spara som mall" buttons when not readOnly
  - The `ChecklistTemplateModal` is rendered conditionally

Key rendering structure:
```typescript
const topLevel = allItems.filter(i => !('parent_id' in i) || i.parent_id === null);
// Render each topLevel item, then its children = items.filter(c => c.parent_id === item.id)
```

Due date badge:
```typescript
{item.due_date && (
  <span className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-1 ${
    isPast(parseISO(item.due_date)) && !item.completed
      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
      : 'bg-muted text-muted-foreground'
  }`}>
    <Calendar className="h-3 w-3" />
    {format(parseISO(item.due_date), 'd MMM', { locale: sv })}
  </span>
)}
```

Date picker (native HTML date input, inline):
```typescript
<input
  type="date"
  value={item.due_date || ''}
  onChange={(e) => onUpdate?.(item.id, { due_date: e.target.value || null })}
  className="sr-only"
  id={`date-${item.id}`}
/>
<label htmlFor={`date-${item.id}`}>
  <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100" asChild>
    <span><Calendar className="h-3 w-3" /></span>
  </Button>
</label>
```

- [ ] Commit:
```bash
git add src/components/TicketChecklist.tsx
git commit -m "feat: add sub-items, due dates, and template actions to TicketChecklist"
```

---

## Task 9: Update TicketDetail.tsx to pass new props

**Files:**
- Modify: `src/pages/TicketDetail.tsx`

- [ ] Import `useChecklistTemplates` hook and fetch templates in component
- [ ] Pass `templates`, `onApplyTemplate`, `onSaveAsTemplate`, and `onUpdate` props to `<TicketChecklist />`
- [ ] `onApplyTemplate` calls `applyTemplate(template.id, ticketId)` then refreshes the checklist
- [ ] `onSaveAsTemplate` prompts for a name (simple `window.prompt` or inline input state) then calls `createTemplate`
- [ ] `onUpdate` calls `updateChecklistItem`
- [ ] `onAdd` with optional `parentId` calls `addChecklistItem` with the parent_id in the request

- [ ] Commit:
```bash
git add src/pages/TicketDetail.tsx
git commit -m "feat: wire template and sub-item props in TicketDetail"
```

---

## Task 10: Settings page — Checklist Templates section

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] Import `useChecklistTemplates`
- [ ] Add a new collapsible section "Checklistmallar" (after Tags or similar section) with icon `ListChecks`
- [ ] The section shows:
  - A list of existing templates with name, item count, Edit and Delete buttons
  - "Skapa ny mall" button that expands an inline form:
    - Name input
    - Description input (optional)
    - Item list with + button and remove per item
    - Sub-item toggle per item (indent button)
    - Save / Cancel buttons
  - Edit mode: same form pre-filled
- [ ] Follow the exact same Collapsible + Card pattern already used for Tags/Categories in the file

- [ ] Commit:
```bash
git add src/pages/Settings.tsx
git commit -m "feat: add Checklist Templates management section to Settings"
```

---

## Task 11: Update TicketForm.tsx (create flow)

**Files:**
- Modify: `src/pages/TicketForm.tsx`

- [ ] Pass `templates` and `onApplyTemplate` to `<TicketChecklist />` in the create form
- [ ] In the create flow, `onApplyTemplate` adds template items to `pendingItems`
- [ ] Note: in create mode there's no ticketId yet, so templates are applied as pending items (labels only, no sub-nesting in pending for simplicity)

- [ ] Commit:
```bash
git add src/pages/TicketForm.tsx
git commit -m "feat: support template selection in TicketForm create flow"
```

---

## Task 12: Final verification

- [ ] Start the backend: `cd server && npm run dev` — confirm no TypeScript errors
- [ ] Start the frontend: `npm run dev` — confirm no TypeScript errors
- [ ] Manual test:
  - [ ] Create a checklist template in Settings
  - [ ] Open a ticket → click "Välj mall" → apply template → items appear
  - [ ] Add a sub-item under an existing item
  - [ ] Set a due date on an item — verify badge appears
  - [ ] Set past due date — verify red badge
  - [ ] "Spara som mall" saves current checklist as new template
  - [ ] Delete a parent item — verify children are deleted too (CASCADE)
- [ ] Commit any last fixes
- [ ] Push branch and create PR

---

## Review Notes
_(to be filled after implementation)_
