#!/usr/bin/env node

/**
 * Automatic migration creation and application
 * 
 * ⚠️ IMPORTANT: Run this EVERY TIME you modify prisma/schema.prisma
 * 
 * This script:
 * 1. Detects schema changes
 * 2. Creates migration file
 * 3. Applies migration
 * 4. Regenerates Prisma client
 * 
 * Usage: node scripts/auto-migrate.js <migration-name>
 * Or: npm run migrate:auto <migration-name>
 * 
 * Example: npm run migrate:auto add_last_login_at
 */

const { execSync } = require('child_process');
const path = require('path');

const migrationName = process.argv[2];

if (!migrationName) {
  console.error('Error: Migration name is required');
  console.log('Usage: node scripts/auto-migrate.js <migration-name>');
  console.log('Example: node scripts/auto-migrate.js add_last_login_at');
  process.exit(1);
}

const serverDir = path.join(__dirname, '..');

try {
  console.log('🔄 Creating and applying migration...\n');

  // Step 1: Create migration
  console.log('Step 1: Creating migration...');
  execSync(`npx prisma migrate dev --name ${migrationName}`, {
    cwd: serverDir,
    stdio: 'inherit'
  });

  // Step 2: Generate Prisma client (migrate dev should do this, but ensure it)
  console.log('\nStep 2: Generating Prisma client...');
  execSync('npx prisma generate', {
    cwd: serverDir,
    stdio: 'inherit'
  });

  console.log('\n✅ Migration completed successfully!');

} catch (error) {
  console.error('\n❌ Migration failed:', error.message);
  console.log('\nIf the migration already exists, you can:');
  console.log('1. Manually edit the migration file');
  console.log('2. Run: npx prisma migrate dev');
  console.log('3. Run: npx prisma generate');
  process.exit(1);
}
