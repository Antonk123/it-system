import { db } from './connection.js';

// Update fields for Prefabmästarna
const updatePrefabFields = () => {
  try {
    console.log('Updating template fields for Prefabmästarna...\n');

    // 1. Update CRM to Business Central
    const crmResult = db.prepare(`
      UPDATE template_fields
      SET field_label = 'Business Central', updated_at = CURRENT_TIMESTAMP
      WHERE field_name = 'access_crm'
    `).run();

    if (crmResult.changes > 0) {
      console.log('✅ Updated "CRM" → "Business Central"');
    } else {
      console.log('⚠️  CRM field not found (might already be updated)');
    }

    // 2. Update email placeholder to @prefabmastarna.se
    const emailResult = db.prepare(`
      UPDATE template_fields
      SET placeholder = 'namn@prefabmastarna.se', updated_at = CURRENT_TIMESTAMP
      WHERE field_name = 'user_email'
    `).run();

    if (emailResult.changes > 0) {
      console.log('✅ Updated email placeholder → "namn@prefabmastarna.se"');
    } else {
      console.log('⚠️  Email field not found (might already be updated)');
    }

    // Show updated fields
    console.log('\n📋 Updated Fields:');
    console.log('─'.repeat(60));

    const crm = db.prepare('SELECT * FROM template_fields WHERE field_name = ?').get('access_crm') as any;
    if (crm) {
      console.log(`  • ${crm.field_label} (${crm.field_name})`);
    }

    const email = db.prepare('SELECT * FROM template_fields WHERE field_name = ?').get('user_email') as any;
    if (email) {
      console.log(`  • ${email.field_label}`);
      console.log(`    Placeholder: ${email.placeholder}`);
    }

    console.log('\n✅ All updates complete!\n');

  } catch (error) {
    console.error('Error updating fields:', error);
    process.exit(1);
  }
};

updatePrefabFields();
