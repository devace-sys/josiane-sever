-- Add session workflow fields for delete and complete acceptance
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "deleteRequestedBy" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "deleteRequestedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "deleteAcceptedBy" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "deleteAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "completeRequestedBy" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "completeRequestedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "completeAcceptedBy" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "completeAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "beforePhoto" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "afterPhoto" TEXT;

-- Add index for status (already in schema but ensure it exists)
CREATE INDEX IF NOT EXISTS "Session_status_idx" ON "Session"("status");

