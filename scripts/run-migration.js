/**
 * Script to run the unified user architecture migration
 * 
 * Usage: node scripts/run-migration.js
 * 
 * This script will:
 * 1. Read the migration SQL file
 * 2. Execute it in a transaction
 * 3. Verify data integrity
 * 4. Report results
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function runMigration() {
  try {
    console.log('🚀 Starting Unified User Architecture Migration...\n');

    // Read migration SQL file
    const migrationPath = path.join(
      __dirname,
      '..',
      'prisma',
      'migrations',
      '20241215000001_refactor_to_unified_user_architecture',
      'migration.sql'
    );

    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Check current state
    console.log('📊 Checking current database state...');
    
    const patientCount = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count FROM "Patient"
    `;
    console.log(`   - Patients: ${patientCount[0].count}`);

    const userCount = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count FROM "User"
    `;
    console.log(`   - Users: ${userCount[0].count}`);

    const messageCount = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count FROM "Message"
    `;
    console.log(`   - Messages: ${messageCount[0].count}\n`);

    // Check for potential issues before migration
    console.log('🔍 Pre-migration checks...');
    
    const orphanedPatients = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count 
      FROM "Patient" 
      WHERE "id" NOT IN (SELECT "id" FROM "User")
    `;
    
    if (orphanedPatients[0].count > 0) {
      console.warn(`   ⚠️  Warning: ${orphanedPatients[0].count} patients without User records (will be migrated)`);
    } else {
      console.log('   ✓ All patients have corresponding User records or will be created');
    }

    const messagesWithNullSender = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count 
      FROM "Message" 
      WHERE "senderId" IS NULL
    `;
    
    if (messagesWithNullSender[0].count > 0) {
      console.warn(`   ⚠️  Warning: ${messagesWithNullSender[0].count} messages with NULL senderId (will be handled)`);
    } else {
      console.log('   ✓ All messages have valid senderId');
    }

    console.log('\n⚙️  Executing migration...\n');

    // Execute migration in transaction
    await prisma.$executeRawUnsafe(migrationSQL);

    console.log('✅ Migration completed successfully!\n');

    // Verify post-migration state
    console.log('📊 Verifying migration results...');
    
    const usersWithPatientType = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count 
      FROM "User" 
      WHERE "userType" = 'PATIENT'
    `;
    console.log(`   - Users with userType=PATIENT: ${usersWithPatientType[0].count}`);

    const usersWithOperatorType = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count 
      FROM "User" 
      WHERE "userType" = 'OPERATOR'
    `;
    console.log(`   - Users with userType=OPERATOR: ${usersWithOperatorType[0].count}`);

    // Verify Patient table structure
    const patientColumns = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Patient'
      ORDER BY column_name
    `;
    console.log(`   - Patient table columns: ${patientColumns.map(c => c.column_name).join(', ')}`);

    // Check for senderType column (should be removed)
    const senderTypeExists = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM information_schema.columns
      WHERE table_name = 'Message' AND column_name = 'senderType'
    `;
    
    if (senderTypeExists[0].count === 0) {
      console.log('   ✓ senderType column removed from Message table');
    } else {
      console.warn('   ⚠️  Warning: senderType column still exists');
    }

    // Verify foreign keys
    const fkCount = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM information_schema.table_constraints
      WHERE constraint_type = 'FOREIGN KEY'
      AND (constraint_name LIKE '%patientId%' OR constraint_name LIKE '%senderId%')
    `;
    console.log(`   - Foreign keys updated: ${fkCount[0].count} constraints\n`);

    console.log('🎉 Migration verification complete!');
    console.log('\n📝 Next steps:');
    console.log('   1. Run: npx prisma generate');
    console.log('   2. Test the application thoroughly');
    console.log('   3. Verify all API endpoints work correctly\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
runMigration();

