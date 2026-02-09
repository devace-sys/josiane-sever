#!/usr/bin/env node

/**
 * Helper script to create Prisma migrations automatically
 * Usage: node scripts/create-migration.js <migration-name>
 * Example: node scripts/create-migration.js add_last_login_at
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const migrationName = process.argv[2];

if (!migrationName) {
  console.error('Error: Migration name is required');
  console.log('Usage: node scripts/create-migration.js <migration-name>');
  console.log('Example: node scripts/create-migration.js add_last_login_at');
  process.exit(1);
}

// Generate timestamp in format YYYYMMDDHHMMSS
const now = new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, '0');
const day = String(now.getDate()).padStart(2, '0');
const hours = String(now.getHours()).padStart(2, '0');
const minutes = String(now.getMinutes()).padStart(2, '0');
const seconds = String(now.getSeconds()).padStart(2, '0');
const timestamp = `${year}${month}${day}${hours}${minutes}${seconds}`;

const migrationDirName = `${timestamp}_${migrationName}`;
const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
const migrationDir = path.join(migrationsDir, migrationDirName);
const migrationFile = path.join(migrationDir, 'migration.sql');

try {
  // Create migration directory
  if (!fs.existsSync(migrationDir)) {
    fs.mkdirSync(migrationDir, { recursive: true });
    console.log(`✓ Created migration directory: ${migrationDirName}`);
  }

  // Create empty migration.sql file
  if (!fs.existsSync(migrationFile)) {
    fs.writeFileSync(migrationFile, `-- Migration: ${migrationName}\n-- Created: ${now.toISOString()}\n\n`);
    console.log(`✓ Created migration file: ${migrationFile}`);
  }

  // Try to generate migration from schema
  console.log('\nAttempting to generate migration from schema...');
  try {
    execSync(`npx prisma migrate dev --name ${migrationName} --create-only`, {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
    console.log('\n✓ Migration generated successfully!');
  } catch (error) {
    console.log('\n⚠ Could not auto-generate migration (this is normal if schema is already synced)');
    console.log(`✓ Migration file created at: ${migrationFile}`);
    console.log('Please edit the migration file manually with your SQL changes.');
  }

  console.log(`\nNext steps:`);
  console.log(`1. Edit ${migrationFile} with your SQL changes`);
  console.log(`2. Run: npx prisma migrate dev`);
  console.log(`3. Run: npx prisma generate`);

} catch (error) {
  console.error('Error creating migration:', error.message);
  process.exit(1);
}
