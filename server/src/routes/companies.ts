import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

interface CompanyRow {
  id: string;
  name: string;
  org_number: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
}

interface CompanyWithStats extends CompanyRow {
  contact_count: number;
  open_ticket_count: number;
  total_ticket_count: number;
}

// GET / — list all companies with stats
router.get('/', authenticate, (_req: AuthRequest, res: Response) => {
  try {
    const companies = db.prepare(`
      SELECT
        co.*,
        (SELECT COUNT(*) FROM contacts c WHERE c.company_id = co.id) as contact_count,
        (SELECT COUNT(*) FROM tickets t WHERE t.company_id = co.id AND t.status NOT IN ('closed', 'resolved')) as open_ticket_count,
        (SELECT COUNT(*) FROM tickets t WHERE t.company_id = co.id) as total_ticket_count
      FROM companies co
      ORDER BY co.name ASC
    `).all() as CompanyWithStats[];
    res.json(companies);
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});

// GET /:id — single company with full stats
router.get('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id) as CompanyRow | undefined;
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const contacts = db.prepare(
      'SELECT id, name, email, phone, created_at FROM contacts WHERE company_id = ? ORDER BY name ASC'
    ).all(company.id);

    const ticketStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status NOT IN ('closed', 'resolved') THEN 1 ELSE 0 END) as open_count,
        SUM(CASE WHEN status = 'closed' AND closed_at IS NOT NULL THEN 1 ELSE 0 END) as closed_count,
        AVG(CASE
          WHEN closed_at IS NOT NULL AND created_at IS NOT NULL
          THEN julianday(closed_at) - julianday(created_at)
          ELSE NULL
        END) as avg_resolution_days
      FROM tickets WHERE company_id = ?
    `).get(company.id) as { total: number; open_count: number; closed_count: number; avg_resolution_days: number | null };

    const totalMinutes = db.prepare(`
      SELECT COALESCE(SUM(te.minutes), 0) as total_minutes
      FROM time_entries te
      JOIN tickets t ON te.ticket_id = t.id
      WHERE t.company_id = ?
    `).get(company.id) as { total_minutes: number };

    res.json({
      ...company,
      contacts,
      stats: {
        ...ticketStats,
        total_minutes: totalMinutes.total_minutes,
      },
    });
  } catch (error) {
    console.error('Error fetching company:', error);
    res.status(500).json({ error: 'Failed to fetch company' });
  }
});

// POST / — create company
router.post('/', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { name, org_number, email, phone, address } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    const id = uuidv4();
    db.prepare(
      'INSERT INTO companies (id, name, org_number, email, phone, address) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, name.trim(), org_number?.trim() || null, email?.trim() || null, phone?.trim() || null, address?.trim() || null);

    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(id) as CompanyRow;
    res.status(201).json(company);
  } catch (error) {
    console.error('Error creating company:', error);
    res.status(500).json({ error: 'Failed to create company' });
  }
});

// PUT /:id — update company
router.put('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const existing = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id) as CompanyRow | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const { name, org_number, email, phone, address } = req.body;
    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name.trim();
    if (org_number !== undefined) updates.org_number = org_number?.trim() || null;
    if (email !== undefined) updates.email = email?.trim() || null;
    if (phone !== undefined) updates.phone = phone?.trim() || null;
    if (address !== undefined) updates.address = address?.trim() || null;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const allowedFields = ['name', 'org_number', 'email', 'phone', 'address', 'updated_at'];
    updates.updated_at = new Date().toISOString();

    const setClauses = Object.keys(updates)
      .filter(k => allowedFields.includes(k))
      .map(k => `${k} = ?`);
    const values = Object.keys(updates)
      .filter(k => allowedFields.includes(k))
      .map(k => updates[k]);

    db.prepare(`UPDATE companies SET ${setClauses.join(', ')} WHERE id = ?`).run(...values, req.params.id);
    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id) as CompanyRow;
    res.json(company);
  } catch (error) {
    console.error('Error updating company:', error);
    res.status(500).json({ error: 'Failed to update company' });
  }
});

// DELETE /:id — delete company (contacts keep their data, company_id set to null via FK)
router.delete('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const existing = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id) as CompanyRow | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Company not found' });
    }

    db.prepare('DELETE FROM companies WHERE id = ?').run(req.params.id);
    res.json({ message: 'Company deleted' });
  } catch (error) {
    console.error('Error deleting company:', error);
    res.status(500).json({ error: 'Failed to delete company' });
  }
});

export default router;
