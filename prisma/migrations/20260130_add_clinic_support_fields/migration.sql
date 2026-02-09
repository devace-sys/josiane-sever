-- AlterTable
ALTER TABLE "ClinicConfig" ADD COLUMN IF NOT EXISTS "supportEmail" TEXT;
ALTER TABLE "ClinicConfig" ADD COLUMN IF NOT EXISTS "supportPhone" TEXT;
