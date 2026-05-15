import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';

const router = Router();

interface SLAPolicyRow {
  id: string;
  company_id: string | null;
  priority: string;
  response_time_minutes: number;
  resolution_time_minutes: number;
  created_at: string;
  updated_at: string;
}

// GET / — list all SLA policies (optionally filter by company_id query param)
router.get('/', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.query.company_id as string | undefined;
    let policies: SLAPolicyRow[];

    if (companyId === 'default') {
      policies = db.prepare('SELECT * FROM sla_policies WHERE company_id IS NULL ORDER BY priority').all() as SLAPolicyRow[];
    } else if (companyId) {
      policies = db.prepare('SELECT * FROM sla_policies WHERE company_id = ? ORDER BY priority').all(companyId) as SLAPolicyRow[];
    } else {
      policies = db.prepare('SELECT * FROM sla_policies ORDER BY company_id, priority').all() as SLAPolicyRow[];
    }

    res.json(policies);
  } catch (error) {
    console.error('Error fetching SLA policies:', error);
    res.status(500).json({ error: 'Failed to fetch SLA policies' });
  }
});

// PUT / — upsert SLA policies for a company (or default). Admin-only:
// policy changes can affect every ticket's deadline calculation, so non-admins
// must not be able to retune them.
router.put('/', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { company_id, policies } = req.body;

    if (!Array.isArray(policies)) {
      return res.status(400).json({ error: 'policies must be an array' });
    }

    const validPriorities = ['low', 'medium', 'high', 'critical'];

    db.transaction(() => {
      // Delete existing policies for this company
      if (company_id) {
        db.prepare('DELETE FROM sla_policies WHERE company_id = ?').run(company_id);
      } else {
        db.prepare('DELETE FROM sla_policies WHERE company_id IS NULL').run();
      }

      // Insert new policies
      const insert = db.prepare(
        'INSERT INTO sla_policies (id, company_id, priority, response_time_minutes, resolution_time_minutes) VALUES (?, ?, ?, ?, ?)'
      );

      for (const p of policies) {
        if (!validPriorities.includes(p.priority)) continue;
        if (!p.response_time_minutes || !p.resolution_time_minutes) continue;
        insert.run(uuidv4(), company_id || null, p.priority, p.response_time_minutes, p.resolution_time_minutes);
      }
    })();

    // Return the updated policies
    const updated = company_id
      ? db.prepare('SELECT * FROM sla_policies WHERE company_id = ? ORDER BY priority').all(company_id) as SLAPolicyRow[]
      : db.prepare('SELECT * FROM sla_policies WHERE company_id IS NULL ORDER BY priority').all() as SLAPolicyRow[];

    res.json(updated);
  } catch (error) {
    console.error('Error updating SLA policies:', error);
    res.status(500).json({ error: 'Failed to update SLA policies' });
  }
});

// DELETE /:id — delete single policy (admin-only)
router.delete('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const result = db.prepare('DELETE FROM sla_policies WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'SLA policy not found' });
    }
    res.json({ message: 'SLA policy deleted' });
  } catch (error) {
    console.error('Error deleting SLA policy:', error);
    res.status(500).json({ error: 'Failed to delete SLA policy' });
  }
});

export default router;
