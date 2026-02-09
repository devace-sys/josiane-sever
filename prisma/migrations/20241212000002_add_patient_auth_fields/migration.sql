-- AlterTable
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "inviteToken" TEXT;
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "inviteTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Patient_inviteToken_key" ON "Patient"("inviteToken") WHERE "inviteToken" IS NOT NULL;

