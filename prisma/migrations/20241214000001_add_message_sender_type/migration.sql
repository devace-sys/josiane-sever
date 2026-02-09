-- AlterTable
-- Add senderType column to Message table to track whether sender is USER or PATIENT
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "senderType" TEXT;

-- Update existing messages to have senderType based on whether senderId exists in User table
UPDATE "Message" 
SET "senderType" = 'USER'
WHERE "senderId" IN (SELECT "id" FROM "User") AND "senderType" IS NULL;

-- For any messages that don't have a matching User, set senderType to 'PATIENT'
-- (This handles edge cases where messages might have been created with patient IDs)
UPDATE "Message"
SET "senderType" = 'PATIENT'
WHERE "senderType" IS NULL;

-- Make senderType NOT NULL after setting values (with default for safety)
ALTER TABLE "Message" ALTER COLUMN "senderType" SET DEFAULT 'USER';
ALTER TABLE "Message" ALTER COLUMN "senderType" SET NOT NULL;

-- Note: The foreign key constraint on senderId remains, but we use raw SQL inserts
-- for patient messages to bypass it. The senderType field helps identify which
-- table to query when fetching sender information.

