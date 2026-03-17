import { db } from './connection.js';

// Update a template field label
const updateFieldLabel = () => {
  const args = process.argv.slice(2);

  if (args.length !== 2) {
    console.error('Usage: npm run update-field-label <field_name> <new_label>');
    console.error('Example: npm run update-field-label access_crm "Business Central"');
    process.exit(1);
  }

  const [fieldName, newLabel] = args;

  try {
    // Find the field
    const field = db.prepare('SELECT * FROM template_fields WHERE field_name = ?').get(fieldName) as any;

    if (!field) {
      console.error(`❌ Field "${fieldName}" not found`);
      process.exit(1);
    }

    console.log(`Found field: ${field.field_label} (${field.field_name})`);

    // Update the label
    const result = db.prepare('UPDATE template_fields SET field_label = ?, updated_at = CURRENT_TIMESTAMP WHERE field_name = ?')
      .run(newLabel, fieldName);

    if (result.changes > 0) {
      console.log(`✅ Successfully updated "${field.field_label}" → "${newLabel}"`);
      console.log(`   Field name: ${fieldName}`);
      console.log(`   Updated: ${result.changes} field(s)`);
    } else {
      console.error('❌ No changes made');
    }

  } catch (error) {
    console.error('Error updating field:', error);
    process.exit(1);
  }
};

updateFieldLabel();
