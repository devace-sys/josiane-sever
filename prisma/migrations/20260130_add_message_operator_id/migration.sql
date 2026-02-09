-- Add operatorId to Message for 1:1 thread scoping (patient:operator conversation)
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "operatorId" TEXT;

-- Backfill: operator-sent messages get their operatorId
UPDATE "Message" m
SET "operatorId" = m."senderId"
FROM "User" u
WHERE m."senderId" = u.id AND u."userType" = 'OPERATOR' AND m."groupId" IS NULL AND m."patientId" IS NOT NULL;

-- Index for thread filtering
CREATE INDEX IF NOT EXISTS "Message_patientId_operatorId_idx" ON "Message"("patientId", "operatorId");
