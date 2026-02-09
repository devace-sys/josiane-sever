/**
 * Script to verify the unified user architecture migration
 * 
 * Usage: node scripts/verify-migration.js
 * 
 * This script verifies that the migration was successful and data integrity is maintained.
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function verifyMigration() {
  try {
    console.log('🔍 Verifying Unified User Architecture Migration...\n');

    let hasErrors = false;

    // 1. Check User table has userType column
    console.log('1. Checking User table structure...');
    const userTypeExists = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM information_schema.columns
      WHERE table_name = 'User' AND column_name = 'userType'
    `;
    
    if (userTypeExists[0].count > 0) {
      console.log('   ✓ userType column exists in User table');
    } else {
      console.error('   ✗ userType column missing in User table');
      hasErrors = true;
    }

    // 2. Check Patient table doesn't have auth fields
    console.log('\n2. Checking Patient table structure...');
    const patientAuthFields = await prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'Patient'
      AND column_name IN ('email', 'password', 'firstName', 'lastName', 'phone', 'profileImage', 'isActive', 'mustChangePassword', 'inviteToken', 'inviteTokenExpiresAt')
    `;
    
    if (patientAuthFields.length === 0) {
      console.log('   ✓ Patient table has no auth fields (correct)');
    } else {
      console.error(`   ✗ Patient table still has auth fields: ${patientAuthFields.map(f => f.column_name).join(', ')}`);
      hasErrors = true;
    }

    // 3. Check all patients have User records
    console.log('\n3. Checking Patient-User relationship...');
    const orphanedPatients = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM "Patient"
      WHERE "id" NOT IN (SELECT "id" FROM "User")
    `;
    
    if (orphanedPatients[0].count === 0) {
      console.log('   ✓ All patients have corresponding User records');
    } else {
      console.error(`   ✗ ${orphanedPatients[0].count} patients without User records`);
      hasErrors = true;
    }

    // 4. Check Message table structure
    console.log('\n4. Checking Message table structure...');
    const senderTypeExists = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM information_schema.columns
      WHERE table_name = 'Message' AND column_name = 'senderType'
    `;
    
    if (senderTypeExists[0].count === 0) {
      console.log('   ✓ senderType column removed from Message table');
    } else {
      console.error('   ✗ senderType column still exists in Message table');
      hasErrors = true;
    }

    const senderIdNullable = await prisma.$queryRaw`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_name = 'Message' AND column_name = 'senderId'
    `;
    
    if (senderIdNullable[0]?.is_nullable === 'NO') {
      console.log('   ✓ senderId is NOT NULL');
    } else {
      console.error('   ✗ senderId is still nullable');
      hasErrors = true;
    }

    // 5. Check all messages have valid senderId
    console.log('\n5. Checking Message senderId references...');
    const invalidSenders = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM "Message" m
      WHERE m."senderId" NOT IN (SELECT "id" FROM "User")
    `;
    
    if (invalidSenders[0].count === 0) {
      console.log('   ✓ All messages have valid senderId references');
    } else {
      console.error(`   ✗ ${invalidSenders[0].count} messages have invalid senderId references`);
      hasErrors = true;
    }

    // 6. Check foreign key constraints
    console.log('\n6. Checking foreign key constraints...');
    const fks = await prisma.$queryRaw`
      SELECT 
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
      AND (kcu.column_name LIKE '%patientId%' OR kcu.column_name LIKE '%senderId%')
      ORDER BY tc.table_name, kcu.column_name
    `;
    
    console.log(`   ✓ Found ${fks.length} foreign key constraints`);
    fks.forEach(fk => {
      if (fk.foreign_table_name === 'User') {
        console.log(`     ✓ ${fk.table_name}.${fk.column_name} → User.id`);
      } else {
        console.error(`     ✗ ${fk.table_name}.${fk.column_name} → ${fk.foreign_table_name} (should be User)`);
        hasErrors = true;
      }
    });

    // 7. Check data counts
    console.log('\n7. Checking data counts...');
    const patientCount = await prisma.$queryRaw`SELECT COUNT(*)::int as count FROM "Patient"`;
    const userPatientCount = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count FROM "User" WHERE "userType" = 'PATIENT'
    `;
    
    if (patientCount[0].count === userPatientCount[0].count) {
      console.log(`   ✓ Patient count matches: ${patientCount[0].count} patients = ${userPatientCount[0].count} users with userType=PATIENT`);
    } else {
      console.error(`   ✗ Count mismatch: ${patientCount[0].count} patients vs ${userPatientCount[0].count} users with userType=PATIENT`);
      hasErrors = true;
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    if (hasErrors) {
      console.error('❌ Migration verification FAILED - Please review errors above');
      process.exit(1);
    } else {
      console.log('✅ Migration verification PASSED - All checks successful!');
      console.log('\n📝 The database is ready for the new architecture.');
    }
    console.log('='.repeat(50) + '\n');

  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run verification
verifyMigration();

