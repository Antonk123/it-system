import { initializeDatabase, db, closeDatabase } from './connection.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../lib/logger.js';

async function main() {
  logger.info('Initializing database...');
  initializeDatabase();

  // Check if admin user exists
  const existingAdmin = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  
  if (!existingAdmin) {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminName = process.env.ADMIN_NAME || '';

    if (!adminPassword) {
      logger.error('ADMIN_PASSWORD environment variable is required when creating admin user.');
      logger.error('Set it in your .env file or pass it directly.');
      process.exit(1);
    }

    const adminId = uuidv4();
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    db.prepare(`
      INSERT INTO users (id, email, password_hash, role, display_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(adminId, adminEmail, passwordHash, 'admin', adminName || null);

    logger.info('Admin user created', { email: adminEmail });
    logger.warn('IMPORTANT: Change password after first login if using defaults!');
  } else {
    logger.info('Admin user already exists, skipping creation.');
  }

  closeDatabase();
  logger.info('Database initialization complete!');
}

main().catch((err) => logger.error('Database init failed', { error: String(err) }));
