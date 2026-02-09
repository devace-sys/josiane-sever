-- CreateEnum
CREATE TYPE "PatientUploadType" AS ENUM ('RECOVERY', 'PROGRESS', 'REACTION');

-- CreateEnum
CREATE TYPE "PatientUploadStatus" AS ENUM ('PENDING', 'REVIEWED', 'APPROVED', 'REJECTED', 'ATTACHED_TO_SESSION');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN', 'LOGOUT', 'CREATE', 'UPDATE', 'DELETE', 'VIEW', 'ACCESS_GRANTED', 'ACCESS_REVOKED', 'PASSWORD_CHANGED', 'FILE_UPLOADED', 'FILE_DELETED');

-- CreateTable
CREATE TABLE "ClinicConfig" (
    "id" TEXT NOT NULL,
    "clinicName" TEXT NOT NULL,
    "logo" TEXT,
    "primaryColor" TEXT DEFAULT '#8e4453',
    "secondaryColor" TEXT DEFAULT '#8b5509',
    "backgroundColor" TEXT DEFAULT '#f9f6f2',
    "surfaceColor" TEXT DEFAULT '#ece0d0',
    "termsOfService" TEXT,
    "privacyPolicy" TEXT,
    "featureChatEnabled" BOOLEAN NOT NULL DEFAULT true,
    "featurePatientUploadsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "featureCommunityEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientUpload" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "uploadType" "PatientUploadType" NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "description" TEXT,
    "status" "PatientUploadStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientUploadReply" (
    "id" TEXT NOT NULL,
    "patientUploadId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientUploadReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userType" "UserType",
    "action" "AuditAction" NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientUpload_patientId_idx" ON "PatientUpload"("patientId");

-- CreateIndex
CREATE INDEX "PatientUpload_status_idx" ON "PatientUpload"("status");

-- CreateIndex
CREATE INDEX "PatientUpload_uploadType_idx" ON "PatientUpload"("uploadType");

-- CreateIndex
CREATE INDEX "PatientUpload_sessionId_idx" ON "PatientUpload"("sessionId");

-- CreateIndex
CREATE INDEX "PatientUploadReply_patientUploadId_idx" ON "PatientUploadReply"("patientUploadId");

-- CreateIndex
CREATE INDEX "PatientUploadReply_operatorId_idx" ON "PatientUploadReply"("operatorId");

-- CreateIndex
CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_idx" ON "AuditLog"("resourceType");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "PatientUpload" ADD CONSTRAINT "PatientUpload_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientUpload" ADD CONSTRAINT "PatientUpload_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientUpload" ADD CONSTRAINT "PatientUpload_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientUploadReply" ADD CONSTRAINT "PatientUploadReply_patientUploadId_fkey" FOREIGN KEY ("patientUploadId") REFERENCES "PatientUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientUploadReply" ADD CONSTRAINT "PatientUploadReply_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

