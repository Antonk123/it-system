import { db } from './connection.js';

// List all template fields
const listFields = () => {
  try {
    const templates = db.prepare('SELECT id, name FROM ticket_templates ORDER BY name').all() as any[];

    if (templates.length === 0) {
      console.log('No templates found');
      return;
    }

    console.log('\n📋 Template Fields\n');

    templates.forEach(template => {
      const fields = db.prepare('SELECT * FROM template_fields WHERE template_id = ? ORDER BY position').all(template.id) as any[];

      console.log(`\n🎫 ${template.name}`);
      console.log('─'.repeat(60));

      if (fields.length === 0) {
        console.log('  (no fields)');
      } else {
        fields.forEach(field => {
          const required = field.required ? '✓' : ' ';
          console.log(`  [${required}] ${field.field_label.padEnd(25)} (${field.field_type})`);
          console.log(`      field_name: ${field.field_name}`);
          if (field.placeholder) {
            console.log(`      placeholder: ${field.placeholder}`);
          }
        });
      }
    });

    console.log('\n');

  } catch (error) {
    console.error('Error listing fields:', error);
    process.exit(1);
  }
};

listFields();
