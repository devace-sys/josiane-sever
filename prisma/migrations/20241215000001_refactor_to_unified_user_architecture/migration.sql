-- Migration: Refactor to Unified User Architecture
-- This migration consolidates Patient and User into a single User table
-- Patient becomes a profile extension where Patient.id = User.id
-- 
-- IMPORTANT: Run this migration in a transaction. Test on backup first.
-- This migration is idempotent (safe to run multiple times).

BEGIN;

-- Step 1: Add userType column to User table (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'User' AND column_name = 'userType'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "userType" "UserType" NOT NULL DEFAULT 'OPERATOR';
  END IF;
END $$;

-- Step 2: Migrate existing Patient records to User table
-- For each Patient, create a corresponding User record with userType=PATIENT
-- Only insert patients that don't already have User records
INSERT INTO "User" (
  "id", "email", "password", "firstName", "lastName", "phone", "profileImage",
  "userType", "role", "isActive", "mustChangePassword", "inviteToken", 
  "inviteTokenExpiresAt", "createdAt", "updatedAt"
)
SELECT 
  "id", "email", "password", "firstName", "lastName", "phone", "profileImage",
  'PATIENT'::"UserType", 'BASIC'::"UserRole", 
  COALESCE("isActive", true), 
  COALESCE("mustChangePassword", true), 
  "inviteToken", "inviteTokenExpiresAt", "createdAt", "updatedAt"
FROM "Patient"
WHERE "id" NOT IN (SELECT "id" FROM "User")
ON CONFLICT ("id") DO UPDATE SET
  "userType" = 'PATIENT'::"UserType"
WHERE "User"."userType" != 'PATIENT'::"UserType";

-- Step 3: Update Patient table - remove auth fields, keep only medical data
-- First, ensure all Patient records have corresponding User records
-- Then drop columns that are now in User table

-- Drop foreign key constraints that reference Patient
ALTER TABLE "PatientAccess" DROP CONSTRAINT IF EXISTS "PatientAccess_patientId_fkey";
ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_patientId_fkey";
ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_patientId_fkey";
ALTER TABLE "PatientContent" DROP CONSTRAINT IF EXISTS "PatientContent_patientId_fkey";
ALTER TABLE "Checklist" DROP CONSTRAINT IF EXISTS "Checklist_patientId_fkey";
ALTER TABLE "BeforeAfter" DROP CONSTRAINT IF EXISTS "BeforeAfter_patientId_fkey";
ALTER TABLE "Showcase" DROP CONSTRAINT IF EXISTS "Showcase_patientId_fkey";
ALTER TABLE "PatientProduct" DROP CONSTRAINT IF EXISTS "PatientProduct_patientId_fkey";
ALTER TABLE "PatientUpload" DROP CONSTRAINT IF EXISTS "PatientUpload_patientId_fkey";

-- Drop auth columns from Patient table
ALTER TABLE "Patient" DROP COLUMN IF EXISTS "email";
ALTER TABLE "Patient" DROP COLUMN IF EXISTS "password";
ALTER TABLE "Patient" DROP COLUMN IF EXISTS "firstName";
ALTER TABLE "Patient" DROP COLUMN IF EXISTS "lastName";
ALTER TABLE "Patient" DROP COLUMN IF EXISTS "phone";
ALTER TABLE "Patient" DROP COLUMN IF EXISTS "profileImage";
ALTER TABLE "Patient" DROP COLUMN IF EXISTS "isActive";
ALTER TABLE "Patient" DROP COLUMN IF EXISTS "mustChangePassword";
ALTER TABLE "Patient" DROP COLUMN IF EXISTS "inviteToken";
ALTER TABLE "Patient" DROP COLUMN IF EXISTS "inviteTokenExpiresAt";

-- Step 4: Add foreign key from Patient.id to User.id (one-to-one)
ALTER TABLE "Patient" 
  ADD CONSTRAINT "Patient_id_fkey" 
  FOREIGN KEY ("id") REFERENCES "User"("id") ON DELETE CASCADE;

-- Step 5: Update Message table - remove senderType, make senderId non-nullable
-- First, ensure all senderId values reference valid User records
-- Update any invalid senderId references (set to a default operator or delete messages)
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  -- Count messages with invalid senderId (not in User table)
  SELECT COUNT(*) INTO invalid_count
  FROM "Message" m
  WHERE m."senderId" NOT IN (SELECT "id" FROM "User");
  
  IF invalid_count > 0 THEN
    RAISE WARNING 'Found % messages with invalid senderId. These will be deleted.', invalid_count;
    -- Delete messages with invalid senderId (or update to valid user if preferred)
    DELETE FROM "Message" WHERE "senderId" NOT IN (SELECT "id" FROM "User");
  END IF;
END $$;

-- Drop senderType column if it exists
ALTER TABLE "Message" DROP COLUMN IF EXISTS "senderType";

-- Make senderId non-nullable (first set NULL values to a valid user if any exist)
DO $$
DECLARE
  null_count INTEGER;
  default_user_id TEXT;
BEGIN
  SELECT COUNT(*) INTO null_count FROM "Message" WHERE "senderId" IS NULL;
  
  IF null_count > 0 THEN
    -- Get first operator user as default (or handle differently)
    SELECT "id" INTO default_user_id FROM "User" WHERE "userType" = 'OPERATOR' LIMIT 1;
    
    IF default_user_id IS NULL THEN
      RAISE EXCEPTION 'Cannot make senderId non-nullable: no operator users exist and % messages have NULL senderId', null_count;
    END IF;
    
    UPDATE "Message" SET "senderId" = default_user_id WHERE "senderId" IS NULL;
    RAISE WARNING 'Updated % messages with NULL senderId to default operator', null_count;
  END IF;
END $$;

ALTER TABLE "Message" ALTER COLUMN "senderId" SET NOT NULL;

-- Drop old foreign key constraint if it exists
ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_senderId_fkey";

-- Add new non-nullable foreign key
ALTER TABLE "Message" 
  ADD CONSTRAINT "Message_senderId_fkey" 
  FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE;

-- Step 6: Update all foreign keys to reference User instead of Patient
-- PatientAccess.patientId -> User.id
ALTER TABLE "PatientAccess" 
  ADD CONSTRAINT "PatientAccess_patientId_fkey" 
  FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE;

-- Session.patientId -> User.id
ALTER TABLE "Session" 
  ADD CONSTRAINT "Session_patientId_fkey" 
  FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE;

-- Message.patientId -> User.id
ALTER TABLE "Message" 
  ADD CONSTRAINT "Message_patientId_fkey" 
  FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE;

-- PatientContent.patientId -> User.id
ALTER TABLE "PatientContent" 
  ADD CONSTRAINT "PatientContent_patientId_fkey" 
  FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE;

-- Checklist.patientId -> User.id
ALTER TABLE "Checklist" 
  ADD CONSTRAINT "Checklist_patientId_fkey" 
  FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE;

-- BeforeAfter.patientId -> User.id
ALTER TABLE "BeforeAfter" 
  ADD CONSTRAINT "BeforeAfter_patientId_fkey" 
  FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE;

-- Showcase.patientId -> User.id
ALTER TABLE "Showcase" 
  ADD CONSTRAINT "Showcase_patientId_fkey" 
  FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE;

-- PatientProduct.patientId -> User.id
ALTER TABLE "PatientProduct" 
  ADD CONSTRAINT "PatientProduct_patientId_fkey" 
  FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE;

-- PatientUpload.patientId -> User.id
ALTER TABLE "PatientUpload" 
  ADD CONSTRAINT "PatientUpload_patientId_fkey" 
  FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE;

-- Step 7: Update PasswordReset to only reference User
ALTER TABLE "PasswordReset" DROP COLUMN IF EXISTS "userType";

-- Step 8: Add indexes for performance
CREATE INDEX IF NOT EXISTS "User_userType_idx" ON "User"("userType");
CREATE INDEX IF NOT EXISTS "Message_patientId_idx" ON "Message"("patientId");
CREATE INDEX IF NOT EXISTS "Message_senderId_idx" ON "Message"("senderId");

-- Step 9: Ensure data integrity - all Patient records must have User records
-- This should already be true from Step 2, but verify
DO $$
DECLARE
  orphaned_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphaned_count
  FROM "Patient" 
  WHERE "id" NOT IN (SELECT "id" FROM "User");
  
  IF orphaned_count > 0 THEN
    RAISE EXCEPTION 'Data integrity violation: % Patient records without User records exist. Migration cannot proceed.', orphaned_count;
  END IF;
END $$;

-- Step 10: Verify Message integrity - all senderId must reference User.id
DO $$
DECLARE
  invalid_sender_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_sender_count
  FROM "Message" m
  WHERE m."senderId" NOT IN (SELECT "id" FROM "User");
  
  IF invalid_sender_count > 0 THEN
    RAISE EXCEPTION 'Data integrity violation: % messages have invalid senderId. Migration cannot proceed.', invalid_sender_count;
  END IF;
END $$;

-- Step 11: Verify all patientId foreign keys reference valid User records
DO $$
DECLARE
  invalid_patient_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_patient_count
  FROM (
    SELECT "patientId" FROM "PatientAccess" WHERE "patientId" NOT IN (SELECT "id" FROM "User")
    UNION
    SELECT "patientId" FROM "Session" WHERE "patientId" NOT IN (SELECT "id" FROM "User")
    UNION
    SELECT "patientId" FROM "Message" WHERE "patientId" NOT IN (SELECT "id" FROM "User")
    UNION
    SELECT "patientId" FROM "PatientContent" WHERE "patientId" NOT IN (SELECT "id" FROM "User")
    UNION
    SELECT "patientId" FROM "Checklist" WHERE "patientId" NOT IN (SELECT "id" FROM "User")
    UNION
    SELECT "patientId" FROM "BeforeAfter" WHERE "patientId" NOT IN (SELECT "id" FROM "User")
    UNION
    SELECT "patientId" FROM "Showcase" WHERE "patientId" NOT IN (SELECT "id" FROM "User")
    UNION
    SELECT "patientId" FROM "PatientProduct" WHERE "patientId" NOT IN (SELECT "id" FROM "User")
    UNION
    SELECT "patientId" FROM "PatientUpload" WHERE "patientId" NOT IN (SELECT "id" FROM "User")
  ) AS invalid_refs;
  
  IF invalid_patient_count > 0 THEN
    RAISE EXCEPTION 'Data integrity violation: % patientId references point to invalid User records. Migration cannot proceed.', invalid_patient_count;
  END IF;
END $$;

COMMIT;

