const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Adding missing columns to Patient table...');
    
    // Add mustChangePassword column
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Patient" 
      ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT true;
    `);
    console.log('✓ Added mustChangePassword column');
    
    // Add inviteToken column
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Patient" 
      ADD COLUMN IF NOT EXISTS "inviteToken" TEXT;
    `);
    console.log('✓ Added inviteToken column');
    
    // Add inviteTokenExpiresAt column
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Patient" 
      ADD COLUMN IF NOT EXISTS "inviteTokenExpiresAt" TIMESTAMP(3);
    `);
    console.log('✓ Added inviteTokenExpiresAt column');
    
    // Create unique index for inviteToken
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "Patient_inviteToken_key" 
      ON "Patient"("inviteToken") 
      WHERE "inviteToken" IS NOT NULL;
    `);
    console.log('✓ Created unique index for inviteToken');
    
    console.log('✅ All columns added successfully!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

