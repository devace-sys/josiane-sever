-- AlterTable: Fix Session model for proper workflow
-- 1. Add dual notes system (patient-visible vs technical)
-- 2. Remove complex workflow fields
-- 3. Add session package support

-- Add new fields
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "patientNotes" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "technicalNotes" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "packageId" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "sessionNumber" INTEGER;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "totalSessions" INTEGER;

-- Migrate existing notes to patientNotes
UPDATE "Session" SET "patientNotes" = "notes" WHERE "notes" IS NOT NULL;

-- Drop old workflow fields (if they exist)
ALTER TABLE "Session" DROP COLUMN IF EXISTS "deleteRequestedBy";
ALTER TABLE "Session" DROP COLUMN IF EXISTS "deleteRequestedAt";
ALTER TABLE "Session" DROP COLUMN IF EXISTS "deleteAcceptedBy";
ALTER TABLE "Session" DROP COLUMN IF EXISTS "deleteAcceptedAt";
ALTER TABLE "Session" DROP COLUMN IF EXISTS "completeRequestedBy";
ALTER TABLE "Session" DROP COLUMN IF EXISTS "completeRequestedAt";
ALTER TABLE "Session" DROP COLUMN IF EXISTS "completeAcceptedBy";
ALTER TABLE "Session" DROP COLUMN IF EXISTS "completeAcceptedAt";

-- Drop old notes column
ALTER TABLE "Session" DROP COLUMN IF EXISTS "notes";

-- Create index on packageId for better performance
CREATE INDEX IF NOT EXISTS "Session_packageId_idx" ON "Session"("packageId");

