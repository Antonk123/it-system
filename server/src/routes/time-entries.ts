import { Router } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

interface TimeEntryRow {
  id: string;
  ticket_id: string;
  duration_minutes: number;
  note: string | null;
  created_at: string;
}

// GET /:ticketId — list all time entries for a ticket with total
router.get('/:ticketId', authenticate, (req: AuthRequest, res) => {
  const { ticketId } = req.params;

  const entries = db.prepare(`
    SELECT id, ticket_id, duration_minutes, note, created_at
    FROM time_entries
    WHERE ticket_id = ?
    ORDER BY created_at DESC
  `).all(ticketId) as TimeEntryRow[];

  const totalRow = db.prepare(`
    SELECT COALESCE(SUM(duration_minutes), 0) as total_minutes
    FROM time_entries
    WHERE ticket_id = ?
  `).get(ticketId) as { total_minutes: number };

  res.json({
    entries,
    total_minutes: totalRow.total_minutes,
  });
});

// POST /:ticketId — create a new time entry
router.post('/:ticketId', authenticate, (req: AuthRequest, res) => {
  const { ticketId } = req.params;
  const { duration_minutes, note } = req.body as { duration_minutes?: unknown; note?: unknown };

  if (
    duration_minutes === undefined ||
    typeof duration_minutes !== 'number' ||
    !Number.isInteger(duration_minutes) ||
    duration_minutes <= 0
  ) {
    res.status(400).json({ error: 'duration_minutes must be a positive integer' });
    return;
  }

  if (note !== undefined && note !== null && typeof note !== 'string') {
    res.status(400).json({ error: 'note must be a string or null' });
    return;
  }

  const noteValue = (note as string | null | undefined) ?? null;

  const id = randomUUID();
  db.prepare(`
    INSERT INTO time_entries (id, ticket_id, duration_minutes, note)
    VALUES (?, ?, ?, ?)
  `).run(id, ticketId, duration_minutes, noteValue);

  const entry = db.prepare(`
    SELECT id, ticket_id, duration_minutes, note, created_at
    FROM time_entries
    WHERE id = ?
  `).get(id) as TimeEntryRow;

  res.status(201).json(entry);
});

// DELETE /:ticketId/:id — remove a specific time entry
router.delete('/:ticketId/:id', authenticate, (req: AuthRequest, res) => {
  const { ticketId, id } = req.params;

  const result = db.prepare(`
    DELETE FROM time_entries
    WHERE id = ? AND ticket_id = ?
  `).run(id, ticketId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Time entry not found' });
    return;
  }

  res.status(204).send();
});

export default router;
