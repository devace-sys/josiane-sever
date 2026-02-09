-- Migration: Add uploadedBy field to SessionFile
-- This migration adds the uploadedBy field to track who uploaded each session file
-- 
-- IMPORTANT: Run this migration in a transaction. Test on backup first.
-- This migration is idempotent (safe to run multiple times).

BEGIN;

-- Step 1: Add uploadedBy column to SessionFile table (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'SessionFile' AND column_name = 'uploadedBy'
  ) THEN
    ALTER TABLE "SessionFile" ADD COLUMN "uploadedBy" TEXT NOT NULL;
  END IF;
END $$;

-- Step 2: Set a default value for existing records (if any)
-- Use the session's operatorId as the default uploadedBy value
DO $$
BEGIN
  UPDATE "SessionFile" sf
  SET "uploadedBy" = s."operatorId"
  FROM "Session" s
  WHERE sf."sessionId" = s."id"
    AND (sf."uploadedBy" IS NULL OR sf."uploadedBy" = '');
END $$;

-- Step 3: Add foreign key constraint to User table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'SessionFile_uploadedBy_fkey'
    AND table_name = 'SessionFile'
  ) THEN
    ALTER TABLE "SessionFile" 
    ADD CONSTRAINT "SessionFile_uploadedBy_fkey" 
    FOREIGN KEY ("uploadedBy") 
    REFERENCES "User"("id") 
    ON DELETE RESTRICT 
    ON UPDATE CASCADE;
  END IF;
END $$;

-- Step 4: Create index on uploadedBy for better query performance
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'SessionFile_uploadedBy_idx'
  ) THEN
    CREATE INDEX "SessionFile_uploadedBy_idx" ON "SessionFile"("uploadedBy");
  END IF;
END $$;

COMMIT;

