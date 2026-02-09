-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "inviteToken" TEXT,
ADD COLUMN IF NOT EXISTS "inviteTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_inviteToken_key" ON "User"("inviteToken");

