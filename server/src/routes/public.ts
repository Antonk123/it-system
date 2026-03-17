import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { sendTicketCreatedEmail } from '../lib/email.js';

const router = Router();

interface ContactRow {
  id: string;
  name: string;
  email: string;
}

interface CategoryRow {
  id: string;
  label: string;
}

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  title_template: string;
  description_template: string;
  priority: string;
  category_id: string | null;
}

// Get public templates (for public ticket form)
router.get('/templates', (_req: Request, res: Response) => {
  try {
    const templates = db.prepare('SELECT id, name, description, title_template, description_template, priority, category_id FROM ticket_templates ORDER BY position ASC, name ASC').all() as TemplateRow[];

    // Attach fields to each template
    const templatesWithFields = templates.map(template => {
      const fields = db.prepare('SELECT * FROM template_fields WHERE template_id = ? ORDER BY position ASC').all(template.id);
      return { ...template, fields };
    });

    res.json(templatesWithFields);
  } catch (error) {
    console.error('Error fetching public templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// Get public categories (for public ticket form)
router.get('/categories', (_req: Request, res: Response) => {
  try {
    const categories = db.prepare('SELECT id, label FROM categories ORDER BY position ASC, created_at ASC').all() as CategoryRow[];
    res.json(categories);
  } catch (error) {
    console.error('Error fetching public categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Submit public ticket
router.post('/tickets', (req: Request, res: Response) => {
  const { name, email, title, description, category, priority, customFields, template_id } = req.body;

  // Validate required fields
  if (!name || !email || !title) {
    return res.status(400).json({ error: 'Name, email, and title are required' });
  }

  // Description is not required if customFields are provided
  if (!description && (!customFields || customFields.length === 0)) {
    return res.status(400).json({ error: 'Either description or custom fields are required' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Validate lengths
  if (name.length > 100) {
    return res.status(400).json({ error: 'Name must be 100 characters or less' });
  }
  if (title.length > 200) {
    return res.status(400).json({ error: 'Title must be 200 characters or less' });
  }
  if (description.length > 5000) {
    return res.status(400).json({ error: 'Description must be 5000 characters or less' });
  }

  // Validate priority
  const validPriorities = ['low', 'medium', 'high', 'critical'];
  const ticketPriority = validPriorities.includes(priority) ? priority : 'medium';

  try {
    // Find or create contact
    let contact = db.prepare('SELECT id FROM contacts WHERE email = ?').get(email) as ContactRow | undefined;
    
    if (!contact) {
      const contactId = uuidv4();
      db.prepare('INSERT INTO contacts (id, name, email) VALUES (?, ?, ?)').run(contactId, name, email);
      contact = { id: contactId, name, email };
    }

    // Validate category exists if provided
    let categoryId: string | null = null;
    if (category) {
      const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(category);
      if (cat) {
        categoryId = category;
      }
    }

    // Create ticket
    const ticketId = uuidv4();

    // Prepare description: when customFields provided, compose ONLY from them (prevents duplicates)
    let finalDescription: string;
    if (customFields && Array.isArray(customFields) && customFields.length > 0) {
      finalDescription = customFields
        .filter((field: any) => field.fieldLabel)
        .map((field: any) => `**${field.fieldLabel}**: ${field.fieldValue || '(ej angivet)'}`)
        .join('  \n');
    } else {
      finalDescription = description || '';
    }

    db.prepare(`
      INSERT INTO tickets (id, title, description, status, priority, category_id, requester_id, template_id)
      VALUES (?, ?, ?, 'open', ?, ?, ?, ?)
    `).run(ticketId, title, finalDescription, ticketPriority, categoryId, contact.id, template_id || null);

    // Store custom field values if provided
    if (customFields && Array.isArray(customFields) && customFields.length > 0) {
      const insertFieldStmt = db.prepare(`
        INSERT INTO ticket_field_values (id, ticket_id, field_name, field_label, field_value)
        VALUES (?, ?, ?, ?, ?)
      `);

      customFields.forEach((field: any) => {
        if (field.fieldName && field.fieldLabel) {
          insertFieldStmt.run(uuidv4(), ticketId, field.fieldName, field.fieldLabel, field.fieldValue || '');
        }
      });
    }

    sendTicketCreatedEmail({
      id: ticketId,
      title,
      description: finalDescription,
      status: 'open',
      priority: ticketPriority,
      categoryId,
      requesterName: contact.name,
      requesterEmail: contact.email,
    }).catch((error) => {
      console.error('Error sending public ticket email:', error);
    });

    res.status(201).json({
      message: 'Ticket submitted successfully',
      ticketId
    });
  } catch (error) {
    console.error('Error creating public ticket:', error);
    res.status(500).json({ error: 'Failed to submit ticket' });
  }
});

export default router;
