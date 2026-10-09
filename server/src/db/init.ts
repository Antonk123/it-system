import { initializeDatabase, db, closeDatabase } from './connection.js';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { logger } from '../lib/logger.js';
import { BCRYPT_ROUNDS, validatePassword } from '../lib/passwordPolicy.js';

async function main() {
  logger.info('Initializing database...');
  initializeDatabase();

  // Check if admin user exists
  const existingAdmin = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  
  if (!existingAdmin) {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminName = process.env.ADMIN_NAME || '';

    if (!adminEmail) {
      logger.error('ADMIN_EMAIL environment variable is required when creating admin user.');
      logger.error('Set it in your .env file or pass it directly.');
      process.exit(1);
    }
    if (!adminPassword) {
      logger.error('ADMIN_PASSWORD environment variable is required when creating admin user.');
      logger.error('Set it in your .env file or pass it directly.');
      process.exit(1);
    }
    const passwordCheck = validatePassword(adminPassword);
    if (!passwordCheck.ok) {
      logger.error('ADMIN_PASSWORD does not meet the password policy.', { reason: passwordCheck.error });
      process.exit(1);
    }

    const adminId = randomUUID();
    const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_ROUNDS);

    db.prepare(`
      INSERT INTO users (id, email, password_hash, role, display_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(adminId, adminEmail, passwordHash, 'admin', adminName || null, new Date().toISOString());

    logger.info('Admin user created', { email: adminEmail });
  } else {
    logger.info('Admin user already exists, skipping creation.');
  }

  closeDatabase();
  logger.info('Database initialization complete!');
}

main().catch((err) => {
  logger.error('Database init failed', { error: String(err) });
  process.exit(1);
});
