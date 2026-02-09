-- Add online status tracking fields to User table
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isOnline" BOOLEAN DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);

-- Update existing users to be offline
UPDATE "User" SET "isOnline" = false WHERE "isOnline" IS NULL;
