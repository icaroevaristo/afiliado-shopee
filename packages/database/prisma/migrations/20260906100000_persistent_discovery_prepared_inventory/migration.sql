-- Persistent discovery and prepared inventory are deliberately separate from
-- the WhatsApp dispatch/outbox path. Discovery may replay a page; a slot may
-- only claim a durable READY row.
ALTER TABLE "CommercialAutomationSettings"
  ADD COLUMN IF NOT EXISTS "usableCandidateLowWatermark" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "usableCandidateTarget" INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS "preparedLowWatermark" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "preparedTarget" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "discoveryPagesPerRun" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "discoveryRefreshCooldownMinutes" INTEGER NOT NULL DEFAULT 60;

CREATE TYPE "CommercialDiscoveryCheckpointStatus" AS ENUM ('ACTIVE', 'EXHAUSTED');
CREATE TYPE "CommercialPreparedMessageStatus" AS ENUM ('READY', 'RESERVED', 'DISPATCHED', 'INVALIDATED');

CREATE TABLE "CommercialDiscoveryCheckpoint" (
  "id" TEXT NOT NULL,
  "identityFingerprint" TEXT NOT NULL,
  "source" "ShopeeOfferSource" NOT NULL,
  "campaignId" TEXT NOT NULL,
  "nicheId" TEXT NOT NULL,
  "query" JSONB NOT NULL,
  "page" INTEGER NOT NULL DEFAULT 1,
  "cursor" TEXT,
  "status" "CommercialDiscoveryCheckpointStatus" NOT NULL DEFAULT 'ACTIVE',
  "nextRefreshAt" TIMESTAMP(3),
  "leaseOwnerId" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastRequestAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "fetchedPages" INTEGER NOT NULL DEFAULT 0,
  "fetchedProducts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialDiscoveryCheckpoint_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommercialDiscoveryCheckpoint_identityFingerprint_key"
  ON "CommercialDiscoveryCheckpoint"("identityFingerprint");
CREATE INDEX "CommercialDiscoveryCheckpoint_status_nextRefreshAt_idx"
  ON "CommercialDiscoveryCheckpoint"("status", "nextRefreshAt");
CREATE INDEX "CommercialDiscoveryCheckpoint_campaignId_nicheId_status_idx"
  ON "CommercialDiscoveryCheckpoint"("campaignId", "nicheId", "status");
CREATE INDEX "CommercialDiscoveryCheckpoint_leaseExpiresAt_idx"
  ON "CommercialDiscoveryCheckpoint"("leaseExpiresAt");

CREATE TABLE "CommercialPreparedMessage" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "groupDestinationId" TEXT NOT NULL,
  "instanceName" TEXT NOT NULL,
  "logicalGroupFingerprint" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "generatedCopyId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "status" "CommercialPreparedMessageStatus" NOT NULL DEFAULT 'READY',
  "reservationOwnerId" TEXT,
  "reservationLeaseExpiresAt" TIMESTAMP(3),
  "invalidatedReason" TEXT,
  "invalidatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialPreparedMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommercialPreparedMessage_runId_key"
  ON "CommercialPreparedMessage"("runId");
CREATE UNIQUE INDEX "CommercialPreparedMessage_campaignId_candidateId_snapshotId_groupDestinationId_key"
  ON "CommercialPreparedMessage"("campaignId", "candidateId", "snapshotId", "groupDestinationId");
CREATE INDEX "CommercialPreparedMessage_campaignId_status_groupDestinationId_instanceName_idx"
  ON "CommercialPreparedMessage"("campaignId", "status", "groupDestinationId", "instanceName");
CREATE INDEX "CommercialPreparedMessage_status_reservationLeaseExpiresAt_idx"
  ON "CommercialPreparedMessage"("status", "reservationLeaseExpiresAt");
CREATE INDEX "CommercialPreparedMessage_candidateId_snapshotId_idx"
  ON "CommercialPreparedMessage"("candidateId", "snapshotId");

ALTER TABLE "CommercialPreparedMessage"
  ADD CONSTRAINT "CommercialPreparedMessage_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "CommercialGroupCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CommercialPreparedMessage_groupDestinationId_fkey"
  FOREIGN KEY ("groupDestinationId") REFERENCES "WhatsAppDestination"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CommercialPreparedMessage_instanceName_fkey"
  FOREIGN KEY ("instanceName") REFERENCES "WhatsAppInstance"("name") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CommercialPreparedMessage_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "CommercialPromotionCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CommercialPreparedMessage_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "CommercialOfferSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CommercialPreparedMessage_generatedCopyId_fkey"
  FOREIGN KEY ("generatedCopyId") REFERENCES "GeneratedCopy"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CommercialPreparedMessage_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "CommercialPipelineRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
