import { db } from './connection.js';

// Remove the Budget field from template
const removeBudgetField = () => {
  try {
    console.log('Removing "Budget" field from templates...\n');

    // Find the budget field
    const budgetField = db.prepare('SELECT * FROM template_fields WHERE field_name = ?').get('budget') as any;

    if (!budgetField) {
      console.log('⚠️  Budget field not found (might already be removed)');
      return;
    }

    console.log(`Found field: ${budgetField.field_label} (${budgetField.field_name})`);

    // Delete the field
    const result = db.prepare('DELETE FROM template_fields WHERE field_name = ?').run('budget');

    if (result.changes > 0) {
      console.log(`✅ Successfully removed "Budget" field from database`);
      console.log(`   Deleted: ${result.changes} field(s)\n`);
    } else {
      console.log('❌ No changes made\n');
    }

  } catch (error) {
    console.error('Error removing field:', error);
    process.exit(1);
  }
};

removeBudgetField();
