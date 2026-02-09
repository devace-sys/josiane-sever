-- Migration: Add Content, Session, and Checklist Features
-- This migration adds fields for:
-- - Content: publishDate, expiresAt, viewCount
-- - PatientContent: isFavorite
-- - Session: reminderSentAt, preparationChecklist, feedbackSubmitted
-- - Checklist: reminderSentAt
-- - SessionFeedback: new model for session feedback

BEGIN;

-- Add Content fields if they don't exist
ALTER TABLE "Content" ADD COLUMN IF NOT EXISTS "publishDate" TIMESTAMP(3);
ALTER TABLE "Content" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "Content" ADD COLUMN IF NOT EXISTS "viewCount" INTEGER NOT NULL DEFAULT 0;

-- Add indexes for Content fields
CREATE INDEX IF NOT EXISTS "Content_publishDate_idx" ON "Content"("publishDate");
CREATE INDEX IF NOT EXISTS "Content_expiresAt_idx" ON "Content"("expiresAt");

-- Add PatientContent.isFavorite if it doesn't exist
ALTER TABLE "PatientContent" ADD COLUMN IF NOT EXISTS "isFavorite" BOOLEAN NOT NULL DEFAULT false;

-- Add index for isFavorite
CREATE INDEX IF NOT EXISTS "PatientContent_isFavorite_idx" ON "PatientContent"("isFavorite");

-- Add Session fields if they don't exist
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "preparationChecklist" JSONB;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "feedbackSubmitted" BOOLEAN NOT NULL DEFAULT false;

-- Add Checklist.reminderSentAt if it doesn't exist
ALTER TABLE "Checklist" ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMP(3);

-- Create SessionFeedback table if it doesn't exist
CREATE TABLE IF NOT EXISTS "SessionFeedback" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comments" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "SessionFeedback_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint on sessionId if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'SessionFeedback_sessionId_key'
  ) THEN
    ALTER TABLE "SessionFeedback" ADD CONSTRAINT "SessionFeedback_sessionId_key" UNIQUE ("sessionId");
  END IF;
END $$;

-- Create foreign key if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'SessionFeedback_sessionId_fkey'
  ) THEN
    ALTER TABLE "SessionFeedback" 
      ADD CONSTRAINT "SessionFeedback_sessionId_fkey" 
      FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- Create index if it doesn't exist
CREATE INDEX IF NOT EXISTS "SessionFeedback_sessionId_idx" ON "SessionFeedback"("sessionId");

COMMIT;

