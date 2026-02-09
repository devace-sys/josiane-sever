#!/usr/bin/env node

/**
 * Script to check if schema has been modified without creating a migration
 * This should be run before commits or as a pre-commit hook
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');

function getSchemaHash() {
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  // Simple hash - in production, use crypto.createHash
  return Buffer.from(schemaContent).toString('base64').substring(0, 32);
}

function getLatestMigration() {
  const migrations = fs.readdirSync(migrationsDir)
    .filter(dir => fs.statSync(path.join(migrationsDir, dir)).isDirectory())
    .sort()
    .reverse();
  
  return migrations[0] || null;
}

function checkMigrationStatus() {
  console.log('🔍 Checking schema migration status...\n');

  try {
    // Check if schema file exists
    if (!fs.existsSync(schemaPath)) {
      console.error('❌ Schema file not found!');
      process.exit(1);
    }

    // Get latest migration
    const latestMigration = getLatestMigration();
    if (!latestMigration) {
      console.warn('⚠️  No migrations found. This might be a new project.');
      return;
    }

    // Try to detect if schema is out of sync
    try {
      execSync('npx prisma migrate status', {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe'
      });
      console.log('✅ Schema is in sync with migrations');
    } catch (error) {
      console.error('❌ Schema changes detected without migration!');
      console.log('\n⚠️  ACTION REQUIRED:');
      console.log('1. Create a migration: npm run migrate:auto <migration-name>');
      console.log('2. Or check status: npx prisma migrate status');
      console.log('\nExample:');
      console.log('  npm run migrate:auto add_new_field');
      process.exit(1);
    }

  } catch (error) {
    console.error('Error checking migration status:', error.message);
    process.exit(1);
  }
}

checkMigrationStatus();
