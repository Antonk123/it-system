import { Router } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { canAccessTicket } from '../lib/ticketAccess.js';
import { logger } from '../lib/logger.js';

const router = Router();

interface TimeEntryRow {
  id: string;
  ticket_id: string;
  user_id: string | null;
  duration_minutes: number;
  note: string | null;
  created_at: string;
}

// GET /:ticketId — list all time entries for a ticket with total
router.get('/:ticketId', authenticate, (req: AuthRequest, res) => {
  try {
    const { ticketId } = req.params;

    // Kontrollera att användaren har behörighet till ärendet
    if (!canAccessTicket(req.user!, ticketId)) {
      res.status(403).json({ error: 'Du har inte behörighet till detta ärende' });
      return;
    }

    const entries = db.prepare(`
      SELECT id, ticket_id, user_id, duration_minutes, note, created_at
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
  } catch (err) {
    logger.error('Fel vid hämtning av tidsregistreringar', { err });
    res.status(500).json({ error: 'Internt serverfel' });
  }
});

// POST /:ticketId — create a new time entry
router.post('/:ticketId', authenticate, (req: AuthRequest, res) => {
  try {
    const { ticketId } = req.params;
    const { duration_minutes, note } = req.body as { duration_minutes?: unknown; note?: unknown };

    if (
      duration_minutes === undefined ||
      typeof duration_minutes !== 'number' ||
      !Number.isInteger(duration_minutes) ||
      duration_minutes <= 0 ||
      duration_minutes > 1440
    ) {
      // 1440 = 24h sanity-tak: blockerar orimliga/felinmatade värden men
      // tillåter legitima långa registreringar upp till ett helt dygn.
      res.status(400).json({ error: 'duration_minutes must be a positive integer between 1 and 1440 (max 24h)' });
      return;
    }

    if (note !== undefined && note !== null && typeof note !== 'string') {
      res.status(400).json({ error: 'note must be a string or null' });
      return;
    }

    const noteValue = (note as string | null | undefined) ?? null;

    // Verify ticket exists and check ownership
    const ticket = db.prepare('SELECT id, assigned_to, created_by FROM tickets WHERE id = ?').get(ticketId) as { id: string; assigned_to: string | null; created_by: string | null } | undefined;
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    if (!isAdmin && ticket.assigned_to !== userId && ticket.created_by !== userId) {
      res.status(403).json({ error: 'Du kan bara logga tid på ärenden du är tilldelad eller skapare av' });
      return;
    }

    const id = randomUUID();
    db.prepare(`
      INSERT INTO time_entries (id, ticket_id, user_id, duration_minutes, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, ticketId, userId, duration_minutes, noteValue);

    const entry = db.prepare(`
      SELECT id, ticket_id, user_id, duration_minutes, note, created_at
      FROM time_entries
      WHERE id = ?
    `).get(id) as TimeEntryRow;

    res.status(201).json(entry);
  } catch (err) {
    logger.error('Fel vid skapande av tidsregistrering', { err });
    res.status(500).json({ error: 'Internt serverfel' });
  }
});

// DELETE /:ticketId/:id — remove a specific time entry
router.delete('/:ticketId/:id', authenticate, (req: AuthRequest, res) => {
  try {
    const { ticketId, id } = req.params;

    const entry = db.prepare(`
      SELECT id, user_id FROM time_entries
      WHERE id = ? AND ticket_id = ?
    `).get(id, ticketId) as { id: string; user_id: string | null } | undefined;

    if (!entry) {
      res.status(404).json({ error: 'Time entry not found' });
      return;
    }

    // Only the creator or an admin can delete a time entry
    if (req.user!.role !== 'admin' && entry.user_id !== req.user!.id) {
      res.status(403).json({ error: 'Du kan bara ta bort dina egna tidsregistreringar' });
      return;
    }

    db.prepare('DELETE FROM time_entries WHERE id = ?').run(id);
    res.status(204).send();
  } catch (err) {
    logger.error('Fel vid borttagning av tidsregistrering', { err });
    res.status(500).json({ error: 'Internt serverfel' });
  }
});

export default router;
