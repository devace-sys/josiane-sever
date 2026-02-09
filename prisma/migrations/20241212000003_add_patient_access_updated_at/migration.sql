-- AlterTable
ALTER TABLE "PatientAccess" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Set updatedAt to createdAt for existing records
UPDATE "PatientAccess" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

-- Make updatedAt NOT NULL after setting values
ALTER TABLE "PatientAccess" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "PatientAccess" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

