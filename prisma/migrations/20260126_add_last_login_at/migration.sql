-- Migration: Add lastLoginAt to User model
-- Created: 2026-01-26
-- Purpose: Track user login activity for Active/Inactive status calculation
-- 
-- This field is used to determine if a user is "Active" (logged in within last 30 days)
-- See: server/src/utils/patientHelpers.ts for status calculation logic

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
