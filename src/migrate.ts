import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import config from '../config.ts';
import wLogger from './winston.js';

async function runMigrations() {
  const db = drizzle(config.databaseUrl);
  wLogger.info('Applying migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  wLogger.info('Migrations applied.');
}

runMigrations().catch((err) => {
  wLogger.error('Migration failed:', err);
  process.exit(1);
});