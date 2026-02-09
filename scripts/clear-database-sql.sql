-- Alternative SQL script to clear all database data
-- This uses TRUNCATE CASCADE which is faster but requires PostgreSQL
-- Run this directly in your database if you prefer SQL over TypeScript

-- WARNING: This will delete ALL data from ALL tables!
-- Make sure you have a backup before running this!

BEGIN;

-- Disable triggers temporarily (optional, for faster execution)
SET session_replication_role = 'replica';

-- Delete in reverse dependency order
-- Using TRUNCATE CASCADE for faster deletion (PostgreSQL only)

TRUNCATE TABLE "AuditLog" CASCADE;
TRUNCATE TABLE "ContentRecommendation" CASCADE;
TRUNCATE TABLE "SessionFeedback" CASCADE;
TRUNCATE TABLE "MessageAttachment" CASCADE;
TRUNCATE TABLE "PatientUploadReply" CASCADE;
TRUNCATE TABLE "PatientUpload" CASCADE;
TRUNCATE TABLE "PatientProduct" CASCADE;
TRUNCATE TABLE "Product" CASCADE;
TRUNCATE TABLE "Showcase" CASCADE;
TRUNCATE TABLE "BeforeAfter" CASCADE;
TRUNCATE TABLE "Checklist" CASCADE;
TRUNCATE TABLE "PatientContent" CASCADE;
TRUNCATE TABLE "Content" CASCADE;
TRUNCATE TABLE "SessionQuestion" CASCADE;
TRUNCATE TABLE "SessionInstruction" CASCADE;
TRUNCATE TABLE "SessionFile" CASCADE;
TRUNCATE TABLE "Session" CASCADE;
TRUNCATE TABLE "Message" CASCADE;
TRUNCATE TABLE "PatientAccess" CASCADE;
TRUNCATE TABLE "PasswordReset" CASCADE;
TRUNCATE TABLE "Patient" CASCADE;
TRUNCATE TABLE "User" CASCADE;
TRUNCATE TABLE "ClinicConfig" CASCADE;

-- Re-enable triggers
SET session_replication_role = 'origin';

COMMIT;

-- Verify tables are empty (optional check)
-- SELECT 
--   schemaname,
--   tablename,
--   n_tup_ins - n_tup_del AS row_count
-- FROM pg_stat_user_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;

