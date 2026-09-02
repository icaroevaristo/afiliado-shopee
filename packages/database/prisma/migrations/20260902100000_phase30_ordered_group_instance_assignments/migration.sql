-- Persist the ordered sender set for each group. The legacy singular
-- assignedInstanceName remains the compatibility/primary assignment.
ALTER TABLE "WhatsAppDestination"
ADD COLUMN "assignmentRevision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "WhatsAppDestination"
ADD CONSTRAINT "WhatsAppDestination_assignmentRevision_check"
CHECK ("assignmentRevision" >= 1);

CREATE TABLE "WhatsAppGroupInstanceAssignment" (
    "id" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppGroupInstanceAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppGroupInstanceAssignment_destinationId_position_key"
ON "WhatsAppGroupInstanceAssignment"("destinationId", "position");

CREATE UNIQUE INDEX "WhatsAppGroupInstanceAssignment_destinationId_instanceName_key"
ON "WhatsAppGroupInstanceAssignment"("destinationId", "instanceName");

CREATE INDEX "WhatsAppGroupInstanceAssignment_instanceName_idx"
ON "WhatsAppGroupInstanceAssignment"("instanceName");

ALTER TABLE "WhatsAppGroupInstanceAssignment"
ADD CONSTRAINT "WhatsAppGroupInstanceAssignment_destinationId_fkey"
FOREIGN KEY ("destinationId") REFERENCES "WhatsAppDestination"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WhatsAppGroupInstanceAssignment"
ADD CONSTRAINT "WhatsAppGroupInstanceAssignment_instanceName_fkey"
FOREIGN KEY ("instanceName") REFERENCES "WhatsAppInstance"("name")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WhatsAppGroupInstanceAssignment"
ADD CONSTRAINT "WhatsAppGroupInstanceAssignment_position_check"
CHECK ("position" >= 0);

-- Materialize the existing singular assignment at position zero. This is
-- deterministic, idempotent, and does not change any existing assignment.
INSERT INTO "WhatsAppGroupInstanceAssignment"
  ("id", "destinationId", "instanceName", "position")
SELECT
  md5('whatsapp-group-instance-assignment:' || destination."id" || ':' || destination."assignedInstanceName"),
  destination."id",
  destination."assignedInstanceName",
  0
FROM "WhatsAppDestination" AS destination
WHERE destination."type" = 'GROUP'
  AND destination."assignedInstanceName" IS NOT NULL
ON CONFLICT ("destinationId", "instanceName") DO NOTHING;
