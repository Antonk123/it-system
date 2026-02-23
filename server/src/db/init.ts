import { initializeDatabase, db, closeDatabase } from './connection.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  console.log('Initializing database...');
  initializeDatabase();

  // Check if admin user exists
  const existingAdmin = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  
  if (!existingAdmin) {
    // Create default admin user
    const adminId = uuidv4();
    const passwordHash = await bcrypt.hash('admin123', 10);
    
    db.prepare(`
      INSERT INTO users (id, email, password_hash, role)
      VALUES (?, ?, ?, ?)
    `).run(adminId, 'admin@example.com', passwordHash, 'admin');
    
    console.log('Default admin user created:');
    console.log('  Email: admin@example.com');
    console.log('  Password: admin123');
    console.log('  IMPORTANT: Change this password after first login!');
  } else {
    console.log('Admin user already exists, skipping creation.');
  }

  closeDatabase();
  console.log('Database initialization complete!');
}

main().catch(console.error);
