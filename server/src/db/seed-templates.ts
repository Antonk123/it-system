import { db } from './connection.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Seed script to create comprehensive IT support templates with dynamic fields
 * Run with: npm run seed-templates
 */

// Helper to get or create category
function getOrCreateCategory(name: string, label: string): string {
  const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: string } | undefined;

  if (existing) {
    console.log(`  ✓ Using existing category: ${label}`);
    return existing.id;
  }

  const id = uuidv4();
  const position = db.prepare('SELECT COUNT(*) as count FROM categories').get() as { count: number };
  db.prepare('INSERT INTO categories (id, name, label, position) VALUES (?, ?, ?, ?)').run(id, name, label, position.count);
  console.log(`  ✓ Created category: ${label}`);
  return id;
}

// Helper to create template
function createTemplate(data: {
  name: string;
  description: string;
  titleTemplate: string;
  descriptionTemplate: string;
  priority: string;
  categoryId: string | null;
  notesTemplate: string | null;
  solutionTemplate: string | null;
}): string {
  const id = uuidv4();
  const position = db.prepare('SELECT COUNT(*) as count FROM ticket_templates').get() as { count: number };

  db.prepare(`
    INSERT INTO ticket_templates (
      id, name, description, title_template, description_template,
      priority, category_id, notes_template, solution_template, position
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.description,
    data.titleTemplate,
    data.descriptionTemplate,
    data.priority,
    data.categoryId,
    data.notesTemplate,
    data.solutionTemplate,
    position.count
  );

  console.log(`  ✓ Created template: ${data.name}`);
  return id;
}

// Helper to create template field
function createField(templateId: string, data: {
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  placeholder?: string;
  defaultValue?: string;
  required: boolean;
  options?: string;
  position: number;
}) {
  const id = uuidv4();

  db.prepare(`
    INSERT INTO template_fields (
      id, template_id, field_name, field_label, field_type,
      placeholder, default_value, required, options, position
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    templateId,
    data.fieldName,
    data.fieldLabel,
    data.fieldType,
    data.placeholder || null,
    data.defaultValue || null,
    data.required ? 1 : 0,
    data.options || null,
    data.position
  );
}

async function main() {
  console.log('\n🚀 Starting template seeding...\n');

  // Ensure categories exist
  console.log('📁 Setting up categories...');
  const categories = {
    hardware: getOrCreateCategory('hardware', 'Hårdvara'),
    software: getOrCreateCategory('software', 'Mjukvara'),
    network: getOrCreateCategory('network', 'Nätverk'),
    access: getOrCreateCategory('access', 'Behörighet'),
    user: getOrCreateCategory('user', 'Användarhantering'),
    general: getOrCreateCategory('general', 'Allmänt'),
    printer: getOrCreateCategory('printer', 'Skrivare'),
  };

  console.log('\n📝 Creating templates with dynamic fields...\n');

  // 1. General IT Support
  console.log('1️⃣ Allmän IT-Support');
  const generalTemplate = createTemplate({
    name: 'Allmän IT-Support',
    description: 'För generella IT-problem när användaren är osäker på kategorin',
    titleTemplate: 'IT-Support: [Beskriv problemet kort]',
    descriptionTemplate: '<p>Använd fälten nedan för att beskriva ditt problem.</p>',
    priority: 'medium',
    categoryId: categories.general,
    notesTemplate: null,
    solutionTemplate: null,
  });
  createField(generalTemplate, { fieldName: 'problem_category', fieldLabel: 'Problemkategori', fieldType: 'select', placeholder: 'Välj kategori', required: true, options: '["Hårdvara", "Mjukvara", "Nätverk", "E-post", "Skrivare", "Telefon", "Övrigt"]', position: 0 });
  createField(generalTemplate, { fieldName: 'problem_description', fieldLabel: 'Problembeskrivning', fieldType: 'textarea', placeholder: 'Beskriv problemet i detalj...', required: true, position: 1 });
  createField(generalTemplate, { fieldName: 'affected_users', fieldLabel: 'Berörda användare/avdelning', fieldType: 'text', placeholder: 'T.ex. "Hela ekonomiavdelningen"', required: false, position: 2 });
  createField(generalTemplate, { fieldName: 'problem_started', fieldLabel: 'När började problemet?', fieldType: 'date', required: false, position: 3 });
  createField(generalTemplate, { fieldName: 'error_message', fieldLabel: 'Felmeddelande (om tillämpligt)', fieldType: 'textarea', placeholder: 'Kopiera eventuellt felmeddelande här...', required: false, position: 4 });
  createField(generalTemplate, { fieldName: 'steps_tried', fieldLabel: 'Vad har du redan prövat?', fieldType: 'textarea', placeholder: 'Lista åtgärder du redan försökt...', required: false, position: 5 });

  // 2. Access Request
  console.log('2️⃣ Behörighetsförfrågan');
  const accessTemplate = createTemplate({
    name: 'Behörighetsförfrågan',
    description: 'Förfrågan om åtkomst till system, mappar eller applikationer',
    titleTemplate: 'Behörighet: [System/Mapp]',
    descriptionTemplate: '<p>Fyll i formuläret för att begära åtkomst.</p>',
    priority: 'medium',
    categoryId: categories.access,
    notesTemplate: '<p>Kontrollera med chef/ansvarig innan åtkomst beviljas.</p>',
    solutionTemplate: null,
  });
  createField(accessTemplate, { fieldName: 'system_name', fieldLabel: 'System/Applikation', fieldType: 'select', placeholder: 'Välj system', required: true, options: '["Business Central", "E-post", "Filserver", "Sharepoint", "Teams", "VPN", "Övrigt"]', position: 0 });
  createField(accessTemplate, { fieldName: 'access_type', fieldLabel: 'Typ av åtkomst', fieldType: 'select', placeholder: 'Välj åtkomstnivå', required: true, options: '["Full åtkomst", "Läsbehörighet", "Skrivbehörighet", "Admin"]', position: 1 });
  createField(accessTemplate, { fieldName: 'folder_path', fieldLabel: 'Mapp/Område (om tillämpligt)', fieldType: 'text', placeholder: 'T.ex. \\\\server\\ekonomi\\rapporter', required: false, position: 2 });
  createField(accessTemplate, { fieldName: 'business_justification', fieldLabel: 'Affärsmotivering', fieldType: 'textarea', placeholder: 'Förklara varför användaren behöver denna åtkomst...', required: true, position: 3 });
  createField(accessTemplate, { fieldName: 'duration', fieldLabel: 'Åtkomstperiod', fieldType: 'select', placeholder: 'Välj period', required: true, options: '["Permanent", "Tillfällig (ange datum)", "Projektbaserad"]', position: 4 });
  createField(accessTemplate, { fieldName: 'end_date', fieldLabel: 'Slutdatum (om tillfällig)', fieldType: 'date', required: false, position: 5 });
  createField(accessTemplate, { fieldName: 'manager_approval', fieldLabel: 'Godkänt av chef/projektledare', fieldType: 'text', placeholder: 'Namn på godkännande chef', required: true, position: 6 });

  // 3. Software Installation
  console.log('3️⃣ Programvaruinstallation');
  const softwareTemplate = createTemplate({
    name: 'Programvaruinstallation',
    description: 'Begäran om installation av ny mjukvara',
    titleTemplate: 'Installation: [Programvarunamn]',
    descriptionTemplate: '<p>Fyll i formuläret för att begära programvaruinstallation.</p>',
    priority: 'medium',
    categoryId: categories.software,
    notesTemplate: '<p>Kontrollera licenser och säkerhet innan installation.</p>',
    solutionTemplate: null,
  });
  createField(softwareTemplate, { fieldName: 'software_name', fieldLabel: 'Programvarunamn', fieldType: 'text', placeholder: 'T.ex. Adobe Acrobat', required: true, position: 0 });
  createField(softwareTemplate, { fieldName: 'version', fieldLabel: 'Version (om känd)', fieldType: 'text', placeholder: 'T.ex. 2024 Pro', required: false, position: 1 });
  createField(softwareTemplate, { fieldName: 'computer_name', fieldLabel: 'Datornamn eller användar-ID', fieldType: 'text', placeholder: 'T.ex. PC-123 eller user@company.com', required: true, position: 2 });
  createField(softwareTemplate, { fieldName: 'business_need', fieldLabel: 'Affärsbehov', fieldType: 'textarea', placeholder: 'Förklara vad programmet ska användas till och varför det behövs...', required: true, position: 3 });
  createField(softwareTemplate, { fieldName: 'license_available', fieldLabel: 'Finns licens?', fieldType: 'select', placeholder: 'Välj licensstatus', required: true, options: '["Ja, företaget äger", "Nej, behöver köpas", "Freeware", "Vet ej"]', position: 4 });
  createField(softwareTemplate, { fieldName: 'installation_deadline', fieldLabel: 'Önskat installationsdatum', fieldType: 'date', required: false, position: 5 });
  createField(softwareTemplate, { fieldName: 'training_needed', fieldLabel: 'Behövs utbildning?', fieldType: 'checkbox', defaultValue: 'Nej', required: false, position: 6 });

  // 4. Password Reset
  console.log('4️⃣ Lösenordsåterställning');
  const passwordTemplate = createTemplate({
    name: 'Lösenordsåterställning',
    description: 'Snabb mall för lösenordsåterställning',
    titleTemplate: 'Lösenordsåterställning: [System]',
    descriptionTemplate: '<p>Använd detta formulär för att återställa ditt lösenord.</p>',
    priority: 'high',
    categoryId: categories.access,
    notesTemplate: '<p>Verifiera användarens identitet innan lösenordsåterställning.</p>',
    solutionTemplate: '<p>Lösenord återställt. Användaren instruerad att ändra vid nästa inloggning.</p>',
  });
  createField(passwordTemplate, { fieldName: 'system', fieldLabel: 'System', fieldType: 'select', placeholder: 'Välj system', required: true, options: '["Windows-inloggning", "E-post", "Business Central", "VPN", "Övrigt"]', position: 0 });
  createField(passwordTemplate, { fieldName: 'username', fieldLabel: 'Användarnamn', fieldType: 'text', placeholder: 'T.ex. john.doe', required: true, position: 1 });
  createField(passwordTemplate, { fieldName: 'last_successful_login', fieldLabel: 'Senaste lyckade inloggning (om känt)', fieldType: 'date', required: false, position: 2 });
  createField(passwordTemplate, { fieldName: 'error_message', fieldLabel: 'Felmeddelande som visas', fieldType: 'text', placeholder: 'T.ex. "Incorrect password"', required: false, position: 3 });
  createField(passwordTemplate, { fieldName: 'account_locked', fieldLabel: 'Kontot är låst', fieldType: 'checkbox', defaultValue: 'Nej', required: false, position: 4 });

  // 5. Network Issue
  console.log('5️⃣ Nätverksproblem');
  const networkTemplate = createTemplate({
    name: 'Nätverksproblem',
    description: 'För anslutningsproblem och nätverksfrågor',
    titleTemplate: 'Nätverk: [Problem]',
    descriptionTemplate: '<p>Beskriv ditt nätverksproblem med formuläret nedan.</p>',
    priority: 'high',
    categoryId: categories.network,
    notesTemplate: null,
    solutionTemplate: null,
  });
  createField(networkTemplate, { fieldName: 'issue_type', fieldLabel: 'Typ av problem', fieldType: 'select', placeholder: 'Välj problemtyp', required: true, options: '["Inget nätverk", "Långsamt nätverk", "Intermittent anslutning", "Kan inte nå specifik tjänst", "VPN-problem"]', position: 0 });
  createField(networkTemplate, { fieldName: 'location', fieldLabel: 'Plats/Kontor', fieldType: 'text', placeholder: 'T.ex. Kontoret Stockholm, rum 304', required: true, position: 1 });
  createField(networkTemplate, { fieldName: 'connection_type', fieldLabel: 'Anslutningstyp', fieldType: 'select', placeholder: 'Välj typ', required: true, options: '["WiFi", "Ethernet (kabel)", "VPN", "Vet ej"]', position: 2 });
  createField(networkTemplate, { fieldName: 'devices_affected', fieldLabel: 'Berörda enheter', fieldType: 'select', placeholder: 'Välj omfattning', required: true, options: '["Endast min dator", "Flera datorer", "Hela avdelningen", "Hela kontoret", "Mobila enheter"]', position: 3 });
  createField(networkTemplate, { fieldName: 'service_unavailable', fieldLabel: 'Vilken tjänst/webbplats kan du inte nå?', fieldType: 'text', placeholder: 'T.ex. outlook.com, businesscentral.dynamics.com', required: false, position: 4 });
  createField(networkTemplate, { fieldName: 'working_yesterday', fieldLabel: 'Fungerade det igår?', fieldType: 'checkbox', defaultValue: 'Ja', required: false, position: 5 });

  // 6. Equipment Return / Offboarding
  console.log('6️⃣ Utrustningsretur / Avslut');
  const offboardingTemplate = createTemplate({
    name: 'Utrustningsretur / Avslut',
    description: 'När en anställd slutar eller returnerar utrustning',
    titleTemplate: 'Avslut: [Anställds namn]',
    descriptionTemplate: '<p>Checklist för offboarding och utrustningsretur.</p>',
    priority: 'medium',
    categoryId: categories.user,
    notesTemplate: '<p><strong>Offboarding-checklist:</strong></p><ul><li>Återlämnad utrustning kontrollerad</li><li>Åtkomst till alla system borttagen</li><li>E-post vidarebefordrad</li><li>Backup av filer skapad (om behövs)</li><li>Chef bekräftad</li></ul>',
    solutionTemplate: '<p>Offboarding slutförd. Alla åtkomster borttagna och utrustning returnerad.</p>',
  });
  createField(offboardingTemplate, { fieldName: 'employee_name', fieldLabel: 'Anställds namn', fieldType: 'text', placeholder: 'För- och efternamn', required: true, position: 0 });
  createField(offboardingTemplate, { fieldName: 'last_day', fieldLabel: 'Sista arbetsdag', fieldType: 'date', required: true, position: 1 });
  createField(offboardingTemplate, { fieldName: 'equipment_list', fieldLabel: 'Utrustning att återlämna', fieldType: 'textarea', placeholder: 'Lista all utrustning:\n- Laptop\n- Skärm\n- Telefon\n- Headset\n- Tangentbord & mus', required: true, position: 2 });
  createField(offboardingTemplate, { fieldName: 'access_revoke', fieldLabel: 'System att ta bort åtkomst från', fieldType: 'textarea', placeholder: 'Lista alla system:\n- Windows-konto\n- E-post\n- Business Central\n- VPN\n- etc.', required: true, position: 3 });
  createField(offboardingTemplate, { fieldName: 'email_forward', fieldLabel: 'Vidarebefordra e-post till', fieldType: 'text', placeholder: 'E-postadress till ersättare eller chef', required: false, position: 4 });
  createField(offboardingTemplate, { fieldName: 'backup_needed', fieldLabel: 'Behövs backup av användarens filer?', fieldType: 'checkbox', defaultValue: 'Nej', required: false, position: 5 });
  createField(offboardingTemplate, { fieldName: 'manager', fieldLabel: 'Chef som bekräftar', fieldType: 'text', placeholder: 'Namn på chef', required: true, position: 6 });

  // 7. Printer Issue
  console.log('7️⃣ Skrivarproblem');
  const printerTemplate = createTemplate({
    name: 'Skrivarproblem',
    description: 'För vanliga skrivarproblem och supportärenden',
    titleTemplate: 'Skrivare: [Skrivarens namn/plats]',
    descriptionTemplate: '<p>Beskriv ditt skrivarproblem.</p>',
    priority: 'medium',
    categoryId: categories.printer,
    notesTemplate: null,
    solutionTemplate: null,
  });
  createField(printerTemplate, { fieldName: 'printer_name', fieldLabel: 'Skrivarens namn/plats', fieldType: 'text', placeholder: 'T.ex. "HP LaserJet kontor 2"', required: true, position: 0 });
  createField(printerTemplate, { fieldName: 'issue_type', fieldLabel: 'Problem', fieldType: 'select', placeholder: 'Välj problem', required: true, options: '["Skriver inte ut", "Dålig utskriftskvalitet", "Papperskassation", "Offline/Hittas ej", "Driver saknas", "Övrigt"]', position: 1 });
  createField(printerTemplate, { fieldName: 'error_code', fieldLabel: 'Felkod (om visas på skrivaren)', fieldType: 'text', placeholder: 'T.ex. E-1234', required: false, position: 2 });
  createField(printerTemplate, { fieldName: 'affects', fieldLabel: 'Berör', fieldType: 'select', placeholder: 'Välj omfattning', required: true, options: '["Endast mig", "Flera användare", "Hela avdelningen", "Hela kontoret"]', position: 3 });
  createField(printerTemplate, { fieldName: 'urgent_print_needed', fieldLabel: 'Behöver skriva ut något brådskande nu', fieldType: 'checkbox', defaultValue: 'Nej', required: false, position: 4 });

  console.log('\n✅ All templates and fields created successfully!\n');
  console.log('📊 Summary:');
  console.log('  - 7 categories ensured');
  console.log('  - 7 comprehensive templates created');
  console.log('  - 43 dynamic fields added across all templates');
  console.log('\n💡 Templates are now available in Settings and when creating new tickets!\n');
}

main().catch(console.error);
