ALTER TABLE "CommercialPromotionCandidate"
  ADD COLUMN "manualSelectionOverride" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "ManualPublicationRequestStatus" AS ENUM (
  'ACCEPTED',
  'PROCESSING',
  'COMPLETED',
  'PARTIAL',
  'BLOCKED',
  'FAILED',
  'AMBIGUOUS'
);

CREATE TYPE "ManualPublicationTargetStatus" AS ENUM (
  'ACCEPTED',
  'PROCESSING',
  'QUEUED',
  'SENT',
  'BLOCKED',
  'FAILED',
  'AMBIGUOUS'
);

CREATE TABLE "ManualPublicationRequest" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "requestedSnapshotId" TEXT NOT NULL,
    "requestedSnapshotRevision" INTEGER NOT NULL,
    "requestedSnapshotFingerprint" TEXT NOT NULL,
    "status" "ManualPublicationRequestStatus" NOT NULL DEFAULT 'ACCEPTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "processingOwnerId" TEXT,
    "processingLeaseExpiresAt" TIMESTAMP(3),

    CONSTRAINT "ManualPublicationRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManualPublicationTarget" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "logicalGroupFingerprint" TEXT NOT NULL,
    "assignedInstanceName" TEXT NOT NULL,
    "candidateId" TEXT,
    "runId" TEXT,
    "dispatchId" TEXT,
    "outboxId" TEXT,
    "status" "ManualPublicationTargetStatus" NOT NULL DEFAULT 'ACCEPTED',
    "blockedReason" TEXT,
    "investigationRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualPublicationTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManualPublicationRequest_idempotencyKey_key"
ON "ManualPublicationRequest"("idempotencyKey");

CREATE INDEX "ManualPublicationRequest_productId_status_idx"
ON "ManualPublicationRequest"("productId", "status");

CREATE INDEX "ManualPublicationRequest_status_createdAt_idx"
ON "ManualPublicationRequest"("status", "createdAt");

CREATE INDEX "ManualPublicationRequest_status_processingLeaseExpiresAt_idx"
ON "ManualPublicationRequest"("status", "processingLeaseExpiresAt");

CREATE UNIQUE INDEX "ManualPublicationTarget_requestId_destinationId_key"
ON "ManualPublicationTarget"("requestId", "destinationId");

CREATE INDEX "ManualPublicationTarget_destinationId_status_idx"
ON "ManualPublicationTarget"("destinationId", "status");

CREATE INDEX "ManualPublicationTarget_campaignId_status_idx"
ON "ManualPublicationTarget"("campaignId", "status");

CREATE INDEX "ManualPublicationTarget_runId_idx"
ON "ManualPublicationTarget"("runId");

CREATE INDEX "ManualPublicationTarget_dispatchId_idx"
ON "ManualPublicationTarget"("dispatchId");

CREATE INDEX "ManualPublicationTarget_outboxId_idx"
ON "ManualPublicationTarget"("outboxId");

ALTER TABLE "ManualPublicationRequest"
ADD CONSTRAINT "ManualPublicationRequest_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "ProductLead"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManualPublicationRequest"
ADD CONSTRAINT "ManualPublicationRequest_requestedSnapshotId_fkey"
FOREIGN KEY ("requestedSnapshotId") REFERENCES "CommercialOfferSnapshot"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManualPublicationTarget"
ADD CONSTRAINT "ManualPublicationTarget_requestId_fkey"
FOREIGN KEY ("requestId") REFERENCES "ManualPublicationRequest"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManualPublicationTarget"
ADD CONSTRAINT "ManualPublicationTarget_destinationId_fkey"
FOREIGN KEY ("destinationId") REFERENCES "WhatsAppDestination"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManualPublicationTarget"
ADD CONSTRAINT "ManualPublicationTarget_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "CommercialGroupCampaign"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManualPublicationTarget"
ADD CONSTRAINT "ManualPublicationTarget_assignedInstanceName_fkey"
FOREIGN KEY ("assignedInstanceName") REFERENCES "WhatsAppInstance"("name")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManualPublicationTarget"
ADD CONSTRAINT "ManualPublicationTarget_candidateId_fkey"
FOREIGN KEY ("candidateId") REFERENCES "CommercialPromotionCandidate"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManualPublicationTarget"
ADD CONSTRAINT "ManualPublicationTarget_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "CommercialPipelineRun"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManualPublicationTarget"
ADD CONSTRAINT "ManualPublicationTarget_dispatchId_fkey"
FOREIGN KEY ("dispatchId") REFERENCES "WhatsAppDispatch"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManualPublicationTarget"
ADD CONSTRAINT "ManualPublicationTarget_outboxId_fkey"
FOREIGN KEY ("outboxId") REFERENCES "CommercialDispatchOutbox"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
