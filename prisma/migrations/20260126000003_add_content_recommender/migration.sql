-- Migration: Add recommendedBy field to ContentRecommendation
-- Created: 2026-01-26
-- Purpose: Track who recommended content to patients

-- Add recommendedBy field
ALTER TABLE "ContentRecommendation" ADD COLUMN IF NOT EXISTS "recommendedBy" TEXT;

-- Set default value for existing rows (use a system ID or leave null initially)
-- UPDATE "ContentRecommendation" SET "recommendedBy" = 'system' WHERE "recommendedBy" IS NULL;

-- Add foreign key constraint (after ensuring all rows have valid values)
-- ALTER TABLE "ContentRecommendation" ADD CONSTRAINT "ContentRecommendation_recommendedBy_fkey" 
--     FOREIGN KEY ("recommendedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
