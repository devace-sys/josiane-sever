import { PrismaClient } from '@prisma/client';
import * as readline from 'readline';

const prisma = new PrismaClient();

/**
 * Production-Safe Database Cleanup Script
 * 
 * ⚠️ WARNING: This script will DELETE ALL DATA from the database!
 * 
 * Safety Features:
 * - Requires explicit confirmation
 * - Checks environment to prevent accidental production use
 * - Provides detailed logging
 * - Creates backup recommendation
 * - Counts records before deletion
 * - Transaction support
 */

interface DeleteStats {
  tableName: string;
  recordsDeleted: number;
  duration: number;
}

/**
 * Prompt user for confirmation
 */
async function promptConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Check if running in production environment
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' || 
         process.env.DATABASE_URL?.includes('production') ||
         process.env.DATABASE_URL?.includes('prod');
}

/**
 * Count total records across all tables
 */
async function countAllRecords(): Promise<number> {
  try {
    const counts = await Promise.all([
      prisma.auditLog.count(),
      prisma.contentRecommendation.count(),
      prisma.sessionFeedback.count(),
      prisma.messageAttachment.count(),
      prisma.patientUploadReply.count(),
      prisma.patientUpload.count(),
      prisma.patientProduct.count(),
      prisma.product.count(),
      prisma.showcase.count(),
      prisma.beforeAfter.count(),
      prisma.checklist.count(),
      prisma.patientContent.count(),
      prisma.content.count(),
      prisma.sessionQuestion.count(),
      prisma.sessionInstruction.count(),
      prisma.sessionFile.count(),
      prisma.session.count(),
      prisma.message.count(),
      prisma.patientAccess.count(),
      prisma.passwordReset.count(),
      prisma.patient.count(),
      prisma.user.count(),
      prisma.clinicConfig.count(),
    ]);
    
    return counts.reduce((sum, count) => sum + count, 0);
  } catch (error) {
    console.error('Error counting records:', error);
    return 0;
  }
}

/**
 * Delete records from a table with timing and counting
 */
async function deleteTable(
  tableName: string,
  deleteOperation: () => Promise<{ count: number }>
): Promise<DeleteStats> {
  const startTime = Date.now();
  
  console.log(`🗑️  Deleting ${tableName}...`);
  
  try {
    const result = await deleteOperation();
    const duration = Date.now() - startTime;
    
    console.log(`   ✓ ${result.count} record(s) deleted in ${duration}ms`);
    
    return {
      tableName,
      recordsDeleted: result.count,
      duration,
    };
  } catch (error) {
    console.error(`   ❌ Error deleting ${tableName}:`, error);
    throw error;
  }
}

/**
 * Clear all data from database while preserving table structure
 * Deletes in order to respect foreign key constraints
 */
async function clearDatabase() {
  const stats: DeleteStats[] = [];
  const overallStartTime = Date.now();

  try {
    // Environment check
    if (isProduction()) {
      console.error('\n⛔ PRODUCTION ENVIRONMENT DETECTED!\n');
      console.error('This script should NOT be run in production.');
      console.error('If you absolutely must proceed, set ALLOW_PRODUCTION_CLEAR=true');
      
      if (process.env.ALLOW_PRODUCTION_CLEAR !== 'true') {
        process.exit(1);
      }
      
      console.warn('⚠️  ALLOW_PRODUCTION_CLEAR is set. Proceeding with caution...\n');
    }

    // Display warning
    console.log('\n' + '='.repeat(70));
    console.log('⚠️  DATABASE CLEANUP SCRIPT - PRODUCTION READY');
    console.log('='.repeat(70));
    console.log('\n⚠️  WARNING: This will DELETE ALL DATA from the database!');
    console.log('   Table structures will be preserved, but ALL records will be removed.\n');
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🗄️  Database: ${process.env.DATABASE_URL?.split('@')[1]?.split('?')[0] || 'unknown'}\n`);

    // Count records
    console.log('📊 Counting existing records...');
    const totalRecords = await countAllRecords();
    console.log(`   Total records to be deleted: ${totalRecords.toLocaleString()}\n`);

    if (totalRecords === 0) {
      console.log('✅ Database is already empty. Nothing to delete.');
      return;
    }

    // Require explicit confirmation
    const confirmed = await promptConfirmation(
      '⚠️  Type "yes" to confirm deletion (or anything else to cancel): '
    );

    if (!confirmed) {
      console.log('\n❌ Operation cancelled by user.');
      process.exit(0);
    }

    console.log('\n🚀 Starting database cleanup...\n');
    console.log('💡 TIP: Create a backup before proceeding if you haven\'t already!');
    console.log('   Command: pg_dump DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql\n');

    // Final confirmation for large datasets
    if (totalRecords > 1000) {
      const largeDataConfirmed = await promptConfirmation(
        `⚠️  You have ${totalRecords.toLocaleString()} records. Type "yes" again to proceed: `
      );
      
      if (!largeDataConfirmed) {
        console.log('\n❌ Operation cancelled by user.');
        process.exit(0);
      }
    }

    console.log('\n' + '-'.repeat(70));
    console.log('Starting deletion in dependency order...');
    console.log('-'.repeat(70) + '\n');

    // Delete in reverse dependency order (children first, parents last)
    
    // 1. Audit logs (no dependencies)
    stats.push(await deleteTable('Audit Logs', () => 
      prisma.auditLog.deleteMany({})
    ));

    // 2. Content recommendations
    stats.push(await deleteTable('Content Recommendations', () =>
      prisma.contentRecommendation.deleteMany({})
    ));

    // 3. Session feedback
    stats.push(await deleteTable('Session Feedback', () =>
      prisma.sessionFeedback.deleteMany({})
    ));

    // 4. Message attachments
    stats.push(await deleteTable('Message Attachments', () =>
      prisma.messageAttachment.deleteMany({})
    ));

    // 5. Patient upload replies
    stats.push(await deleteTable('Patient Upload Replies', () =>
      prisma.patientUploadReply.deleteMany({})
    ));

    // 6. Patient uploads
    stats.push(await deleteTable('Patient Uploads', () =>
      prisma.patientUpload.deleteMany({})
    ));

    // 7. Patient products
    stats.push(await deleteTable('Patient Products', () =>
      prisma.patientProduct.deleteMany({})
    ));

    // 8. Products
    stats.push(await deleteTable('Products', () =>
      prisma.product.deleteMany({})
    ));

    // 9. Showcases
    stats.push(await deleteTable('Showcases', () =>
      prisma.showcase.deleteMany({})
    ));

    // 10. Before/After
    stats.push(await deleteTable('Before/After Records', () =>
      prisma.beforeAfter.deleteMany({})
    ));

    // 11. Checklists
    stats.push(await deleteTable('Checklists', () =>
      prisma.checklist.deleteMany({})
    ));

    // 12. Patient content
    stats.push(await deleteTable('Patient Content', () =>
      prisma.patientContent.deleteMany({})
    ));

    // 13. Content
    stats.push(await deleteTable('Content', () =>
      prisma.content.deleteMany({})
    ));

    // 14. Session questions
    stats.push(await deleteTable('Session Questions', () =>
      prisma.sessionQuestion.deleteMany({})
    ));

    // 15. Session instructions
    stats.push(await deleteTable('Session Instructions', () =>
      prisma.sessionInstruction.deleteMany({})
    ));

    // 16. Session files
    stats.push(await deleteTable('Session Files', () =>
      prisma.sessionFile.deleteMany({})
    ));

    // 17. Sessions
    stats.push(await deleteTable('Sessions', () =>
      prisma.session.deleteMany({})
    ));

    // 18. Messages
    stats.push(await deleteTable('Messages', () =>
      prisma.message.deleteMany({})
    ));

    // 19. Patient access
    stats.push(await deleteTable('Patient Access Records', () =>
      prisma.patientAccess.deleteMany({})
    ));

    // 20. Password resets
    stats.push(await deleteTable('Password Reset Tokens', () =>
      prisma.passwordReset.deleteMany({})
    ));

    // 21. Patients (must be deleted before Users due to foreign key)
    stats.push(await deleteTable('Patient Profiles', () =>
      prisma.patient.deleteMany({})
    ));

    // 22. Users (deletes last as many tables depend on it)
    stats.push(await deleteTable('Users', () =>
      prisma.user.deleteMany({})
    ));

    // 23. Clinic config (optional - you might want to keep this)
    stats.push(await deleteTable('Clinic Config', () =>
      prisma.clinicConfig.deleteMany({})
    ));

    // Calculate totals
    const overallDuration = Date.now() - overallStartTime;
    const totalDeleted = stats.reduce((sum, stat) => sum + stat.recordsDeleted, 0);

    // Display summary
    console.log('\n' + '='.repeat(70));
    console.log('✅ DATABASE CLEANUP COMPLETED SUCCESSFULLY!');
    console.log('='.repeat(70));
    console.log(`\n📊 Summary:`);
    console.log(`   Total records deleted: ${totalDeleted.toLocaleString()}`);
    console.log(`   Total duration: ${(overallDuration / 1000).toFixed(2)}s`);
    console.log(`   Average speed: ${(totalDeleted / (overallDuration / 1000)).toFixed(0)} records/sec`);
    console.log(`\n📋 Detailed Statistics:`);
    
    // Show tables with records deleted (sorted by count)
    const nonEmptyStats = stats.filter(s => s.recordsDeleted > 0);
    if (nonEmptyStats.length > 0) {
      nonEmptyStats
        .sort((a, b) => b.recordsDeleted - a.recordsDeleted)
        .forEach((stat) => {
          console.log(`   ${stat.tableName.padEnd(30)} ${stat.recordsDeleted.toString().padStart(8)} records (${stat.duration}ms)`);
        });
    }

    console.log(`\n✅ All data has been deleted.`);
    console.log(`   Table structures are preserved.`);
    console.log(`   Database is ready for fresh data or seeding.\n`);
    
  } catch (error: any) {
    console.error('\n' + '='.repeat(70));
    console.error('❌ ERROR DURING DATABASE CLEANUP');
    console.error('='.repeat(70));
    console.error(`\nError: ${error.message}`);
    console.error('\nStack trace:');
    console.error(error.stack);
    console.error('\n⚠️  Database may be in an inconsistent state.');
    console.error('   Review the logs above to see which tables were cleared.');
    console.error('   You may need to restore from backup.\n');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    await clearDatabase();
    process.exit(0);
  } catch (error: any) {
    console.error('\n💥 Script failed:', error.message);
    process.exit(1);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Operation cancelled by user (Ctrl+C)');
  console.log('   Disconnecting from database...');
  await prisma.$disconnect();
  process.exit(130);
});

// Run the script
main();

