import { initializeDatabase, db, closeDatabase } from './connection.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';

async function main() {
  console.log('Initializing database...');
  initializeDatabase();

  // Check if admin user exists
  const existingAdmin = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');

  if (!existingAdmin) {
    // Create default admin user with a randomly generated password
    const adminId = uuidv4();
    const generatedPassword = randomBytes(16).toString('base64url').slice(0, 20);
    const passwordHash = await bcrypt.hash(generatedPassword, 10);

    db.prepare(`
      INSERT INTO users (id, email, password_hash, role)
      VALUES (?, ?, ?, ?)
    `).run(adminId, 'admin@example.com', passwordHash, 'admin');

    console.log('Default admin user created:');
    console.log('  Email: admin@example.com');
    console.log(`  Password: ${generatedPassword}`);
    console.log('  IMPORTANT: Change this password after first login!');
    // Machine-readable line for setup scripts to extract the password
    console.log(`ADMIN_PASSWORD=${generatedPassword}`);
  } else {
    console.log('Admin user already exists, skipping creation.');
  }

  closeDatabase();
  console.log('Database initialization complete!');
}

main().catch(console.error);
