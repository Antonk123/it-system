import { db } from './connection.js';
import { randomUUID } from 'crypto';

// Add fields for "Ny användare" template
const addNewUserTemplateFields = () => {
  try {
    const newUserTemplate = db.prepare("SELECT id, name FROM ticket_templates WHERE name = ?").get("Ny användare") as { id: string; name: string } | undefined;

    if (!newUserTemplate) {
      console.error('Template "Ny användare" not found');
      process.exit(1);
    }

    console.log(`Found template: ${newUserTemplate.name} (${newUserTemplate.id})`);

    // Check existing fields
    const existingFields = db.prepare("SELECT COUNT(*) as count FROM template_fields WHERE template_id = ?").get(newUserTemplate.id) as { count: number };

    if (existingFields.count > 0) {
      console.log(`Template already has ${existingFields.count} fields. Skipping.`);
      process.exit(0);
    }

    const fields = [
      { name: 'user_name', label: 'Namn', type: 'text', placeholder: 'För- och efternamn', required: 1, position: 0 },
      { name: 'user_email', label: 'E-post', type: 'text', placeholder: 'namn@företag.se', required: 1, position: 1 },
      { name: 'department', label: 'Avdelning', type: 'text', placeholder: 'T.ex. Ekonomi', required: 1, position: 2 },
      { name: 'manager', label: 'Chef', type: 'text', placeholder: 'Namn på chef', required: 1, position: 3 },
      { name: 'start_date', label: 'Startdatum', type: 'date', placeholder: '', required: 1, position: 4 },
      { name: 'access_email', label: 'E-postkonto', type: 'checkbox', placeholder: '', required: 0, position: 5 },
      { name: 'access_fileserver', label: 'Filserver', type: 'checkbox', placeholder: '', required: 0, position: 6 },
      { name: 'access_crm', label: 'CRM', type: 'checkbox', placeholder: '', required: 0, position: 7 },
      { name: 'access_other', label: 'Annan åtkomst', type: 'text', placeholder: 'Beskriv övrig åtkomst som behövs', required: 0, position: 8 }
    ];

    const insertStmt = db.prepare(`
      INSERT INTO template_fields (id, template_id, field_name, field_label, field_type, placeholder, required, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    console.log(`Inserting ${fields.length} fields...`);

    for (const field of fields) {
      const id = randomUUID();
      insertStmt.run(id, newUserTemplate.id, field.name, field.label, field.type, field.placeholder, field.required, field.position);
      console.log(`  ✓ Added: ${field.label} (${field.type})`);
    }

    console.log(`\n✅ Successfully added ${fields.length} fields to "Ny användare" template!`);

  } catch (error) {
    console.error('Error adding fields:', error);
    process.exit(1);
  }
};

addNewUserTemplateFields();
