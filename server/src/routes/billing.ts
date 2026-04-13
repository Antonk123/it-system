import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

// --- Billing Rates ---

interface BillingRateRow {
  id: string;
  company_id: string;
  rate_per_hour: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

// GET /rates/:companyId — get billing rate for a company
router.get('/rates/:companyId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const rate = db.prepare('SELECT * FROM billing_rates WHERE company_id = ?').get(req.params.companyId) as BillingRateRow | undefined;
    res.json(rate || null);
  } catch (error) {
    console.error('Error fetching billing rate:', error);
    res.status(500).json({ error: 'Failed to fetch billing rate' });
  }
});

// PUT /rates/:companyId — upsert billing rate
router.put('/rates/:companyId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { rate_per_hour, currency } = req.body;
    if (!rate_per_hour || typeof rate_per_hour !== 'number' || rate_per_hour <= 0) {
      return res.status(400).json({ error: 'rate_per_hour must be a positive number' });
    }

    const existing = db.prepare('SELECT id FROM billing_rates WHERE company_id = ?').get(req.params.companyId) as { id: string } | undefined;

    if (existing) {
      db.prepare('UPDATE billing_rates SET rate_per_hour = ?, currency = ?, updated_at = ? WHERE company_id = ?')
        .run(rate_per_hour, currency || 'SEK', new Date().toISOString(), req.params.companyId);
    } else {
      db.prepare('INSERT INTO billing_rates (id, company_id, rate_per_hour, currency) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), req.params.companyId, rate_per_hour, currency || 'SEK');
    }

    const rate = db.prepare('SELECT * FROM billing_rates WHERE company_id = ?').get(req.params.companyId) as BillingRateRow;
    res.json(rate);
  } catch (error) {
    console.error('Error updating billing rate:', error);
    res.status(500).json({ error: 'Failed to update billing rate' });
  }
});

// --- Invoices ---

interface InvoiceRow {
  id: string;
  company_id: string;
  period_start: string;
  period_end: string;
  status: string;
  total_hours: number;
  total_amount: number;
  currency: string;
  pdf_path: string | null;
  created_at: string;
  sent_at: string | null;
  paid_at: string | null;
}

interface InvoiceLineRow {
  id: string;
  invoice_id: string;
  ticket_id: string | null;
  time_entry_id: string | null;
  description: string;
  hours: number;
  rate: number;
  amount: number;
}

// GET /invoices — list invoices (optionally filter by company_id)
router.get('/invoices', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.query.company_id as string | undefined;
    let invoices: any[];

    if (companyId) {
      invoices = db.prepare(`
        SELECT i.*, co.name as company_name
        FROM invoices i
        JOIN companies co ON i.company_id = co.id
        WHERE i.company_id = ?
        ORDER BY i.created_at DESC
      `).all(companyId);
    } else {
      invoices = db.prepare(`
        SELECT i.*, co.name as company_name
        FROM invoices i
        JOIN companies co ON i.company_id = co.id
        ORDER BY i.created_at DESC
      `).all();
    }

    res.json(invoices);
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// GET /invoices/:id — get single invoice with lines
router.get('/invoices/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const invoice = db.prepare(`
      SELECT i.*, co.name as company_name, co.org_number, co.email as company_email, co.address as company_address
      FROM invoices i
      JOIN companies co ON i.company_id = co.id
      WHERE i.id = ?
    `).get(req.params.id) as any;

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const lines = db.prepare(`
      SELECT il.*, t.title as ticket_title
      FROM invoice_lines il
      LEFT JOIN tickets t ON il.ticket_id = t.id
      WHERE il.invoice_id = ?
      ORDER BY il.created_at ASC
    `).all(invoice.id);

    res.json({ ...invoice, lines });
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// POST /invoices/preview — preview invoice (don't save)
// Body: { company_id, period_start, period_end }
router.post('/invoices/preview', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { company_id, period_start, period_end } = req.body;
    if (!company_id || !period_start || !period_end) {
      return res.status(400).json({ error: 'company_id, period_start, and period_end are required' });
    }

    // Get billing rate
    const rate = db.prepare('SELECT rate_per_hour, currency FROM billing_rates WHERE company_id = ?')
      .get(company_id) as { rate_per_hour: number; currency: string } | undefined;

    if (!rate) {
      return res.status(400).json({ error: 'No billing rate set for this company' });
    }

    // Get time entries for this company in the period
    const entries = db.prepare(`
      SELECT te.id as time_entry_id, te.ticket_id, te.duration_minutes, te.note, te.created_at,
             t.title as ticket_title
      FROM time_entries te
      JOIN tickets t ON te.ticket_id = t.id
      WHERE t.company_id = ?
        AND te.created_at >= ?
        AND te.created_at < ?
      ORDER BY te.created_at ASC
    `).all(company_id, period_start, period_end) as any[];

    // Group by ticket
    const ticketMap = new Map<string, { ticket_id: string; ticket_title: string; total_minutes: number; entries: any[] }>();

    for (const entry of entries) {
      if (!ticketMap.has(entry.ticket_id)) {
        ticketMap.set(entry.ticket_id, {
          ticket_id: entry.ticket_id,
          ticket_title: entry.ticket_title,
          total_minutes: 0,
          entries: [],
        });
      }
      const group = ticketMap.get(entry.ticket_id)!;
      group.total_minutes += entry.duration_minutes;
      group.entries.push(entry);
    }

    // Build lines
    const lines = Array.from(ticketMap.values()).map(group => {
      const hours = Math.round(group.total_minutes / 60 * 100) / 100;
      return {
        ticket_id: group.ticket_id,
        description: group.ticket_title,
        hours,
        rate: rate.rate_per_hour,
        amount: Math.round(hours * rate.rate_per_hour * 100) / 100,
        entry_count: group.entries.length,
      };
    });

    const totalHours = lines.reduce((sum, l) => sum + l.hours, 0);
    const totalAmount = lines.reduce((sum, l) => sum + l.amount, 0);

    res.json({
      company_id,
      period_start,
      period_end,
      rate_per_hour: rate.rate_per_hour,
      currency: rate.currency,
      lines,
      total_hours: Math.round(totalHours * 100) / 100,
      total_amount: Math.round(totalAmount * 100) / 100,
    });
  } catch (error) {
    console.error('Error previewing invoice:', error);
    res.status(500).json({ error: 'Failed to preview invoice' });
  }
});

// POST /invoices — create invoice from preview
router.post('/invoices', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { company_id, period_start, period_end, lines, total_hours, total_amount, currency } = req.body;

    if (!company_id || !period_start || !period_end || !lines) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const invoiceId = uuidv4();

    db.transaction(() => {
      db.prepare(`
        INSERT INTO invoices (id, company_id, period_start, period_end, total_hours, total_amount, currency)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(invoiceId, company_id, period_start, period_end, total_hours, total_amount, currency || 'SEK');

      const insertLine = db.prepare(`
        INSERT INTO invoice_lines (id, invoice_id, ticket_id, description, hours, rate, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const line of lines) {
        insertLine.run(uuidv4(), invoiceId, line.ticket_id || null, line.description, line.hours, line.rate, line.amount);
      }
    })();

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
    res.status(201).json(invoice);
  } catch (error) {
    console.error('Error creating invoice:', error);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// PUT /invoices/:id/status — update invoice status (draft -> sent -> paid)
router.put('/invoices/:id/status', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.body;
    if (!['draft', 'sent', 'paid'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as InvoiceRow | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const updates: Record<string, any> = { status };
    if (status === 'sent') updates.sent_at = new Date().toISOString();
    if (status === 'paid') updates.paid_at = new Date().toISOString();

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);

    db.prepare(`UPDATE invoices SET ${setClauses} WHERE id = ?`).run(...values, req.params.id);

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
    res.json(invoice);
  } catch (error) {
    console.error('Error updating invoice status:', error);
    res.status(500).json({ error: 'Failed to update invoice status' });
  }
});

// DELETE /invoices/:id — delete draft invoice
router.delete('/invoices/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as InvoiceRow | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    if (existing.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft invoices can be deleted' });
    }

    db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
    res.json({ message: 'Invoice deleted' });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

export default router;
