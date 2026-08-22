CREATE TABLE "WhatsAppInstance" (
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppInstance_pkey" PRIMARY KEY ("name")
);

ALTER TABLE "WhatsAppDestination"
ADD COLUMN "assignedInstanceName" TEXT;

ALTER TABLE "CommercialPipelineRun"
ADD COLUMN "instanceName" TEXT;

ALTER TABLE "WhatsAppDispatch"
ADD COLUMN "instanceName" TEXT;

ALTER TABLE "CommercialDispatchOutbox"
ADD COLUMN "instanceName" TEXT;

INSERT INTO "WhatsAppInstance" ("name", "active", "createdAt", "updatedAt")
SELECT DISTINCT "sourceInstanceName", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "WhatsAppDestination"
WHERE "sourceInstanceName" IS NOT NULL
ON CONFLICT ("name") DO NOTHING;

UPDATE "WhatsAppDestination"
SET "assignedInstanceName" = "sourceInstanceName"
WHERE "sourceInstanceName" IS NOT NULL
  AND "assignedInstanceName" IS NULL;

CREATE INDEX "WhatsAppDestination_assignedInstanceName_idx"
ON "WhatsAppDestination"("assignedInstanceName");

CREATE INDEX "CommercialPipelineRun_instanceName_idx"
ON "CommercialPipelineRun"("instanceName");

CREATE INDEX "WhatsAppDispatch_instanceName_idx"
ON "WhatsAppDispatch"("instanceName");

CREATE INDEX "CommercialDispatchOutbox_instanceName_idx"
ON "CommercialDispatchOutbox"("instanceName");

ALTER TABLE "WhatsAppDestination"
ADD CONSTRAINT "WhatsAppDestination_assignedInstanceName_fkey"
FOREIGN KEY ("assignedInstanceName") REFERENCES "WhatsAppInstance"("name")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommercialPipelineRun"
ADD CONSTRAINT "CommercialPipelineRun_instanceName_fkey"
FOREIGN KEY ("instanceName") REFERENCES "WhatsAppInstance"("name")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WhatsAppDispatch"
ADD CONSTRAINT "WhatsAppDispatch_instanceName_fkey"
FOREIGN KEY ("instanceName") REFERENCES "WhatsAppInstance"("name")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommercialDispatchOutbox"
ADD CONSTRAINT "CommercialDispatchOutbox_instanceName_fkey"
FOREIGN KEY ("instanceName") REFERENCES "WhatsAppInstance"("name")
ON DELETE RESTRICT ON UPDATE CASCADE;
