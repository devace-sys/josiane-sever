-- AlterTable
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Set updatedAt to createdAt for existing records
UPDATE "Message" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

-- Make updatedAt NOT NULL after setting values
ALTER TABLE "Message" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Message" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

