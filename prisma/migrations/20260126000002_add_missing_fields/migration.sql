-- Migration: Add missing workflow fields
-- Created: 2026-01-26
-- Purpose: Add deleteAcceptedBy, deleteAcceptedAt to Session and rejectionReason to PatientUpload

-- Add deletion acceptance fields to Session
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "deleteAcceptedBy" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "deleteAcceptedAt" TIMESTAMP(3);

-- Add rejection reason to PatientUpload
ALTER TABLE "PatientUpload" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
