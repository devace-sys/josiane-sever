-- AlterTable
ALTER TABLE "SessionFile" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PATIENT_VISIBLE';

-- CreateEnum
CREATE TYPE "FileVisibility" AS ENUM ('PATIENT_VISIBLE', 'OPERATOR_ONLY');

-- AlterTable
ALTER TABLE "SessionFile" ALTER COLUMN "visibility" TYPE "FileVisibility" USING "visibility"::"FileVisibility";

