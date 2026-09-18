import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { loadEnv } from '../src/config/env.js';
import { Admin } from '../src/models/Admin.js';

dotenv.config({ quiet: true });

async function main() {
  const env = loadEnv();
  await connectDb(env.mongoUri);

  const email = process.env.SEED_ADMIN_EMAIL || 'admin@damic.local';
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme123';
  const name = process.env.SEED_ADMIN_NAME || 'Admin';

  const existing = await Admin.findOne({ email });
  if (existing) {
    console.log(`Admin already exists: ${email}`);
  } else {
    const passwordHash = await bcrypt.hash(password, 10);
    await Admin.create({ name, email, passwordHash, role: 'admin' });
    console.log(`Created admin ${email} (password from SEED_ADMIN_PASSWORD or default)`);
  }

  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});