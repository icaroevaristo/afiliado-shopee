ALTER TABLE "CommercialDiscoveryCheckpoint"
  ADD COLUMN "leaseRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CommercialPreparedMessage"
  ALTER COLUMN "runId" DROP NOT NULL;

ALTER TABLE "CommercialPreparedMessage"
  ADD COLUMN "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "copyPreview" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "offerEndsAt" TIMESTAMP(3),
  ADD COLUMN "scheduleRevision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "assignmentRevision" INTEGER NOT NULL DEFAULT 1;

DROP INDEX "CommercialPreparedMessage_campaignId_candidateId_snapshotId_groupDestinationId_key";

CREATE UNIQUE INDEX "CommercialPreparedMessage_campaignId_candidateId_snapshotId_groupDestinationId_instanceName_scheduleRevision_assignmentRevision_key"
  ON "CommercialPreparedMessage"("campaignId", "candidateId", "snapshotId", "groupDestinationId", "instanceName", "scheduleRevision", "assignmentRevision");

CREATE INDEX "CommercialPreparedMessage_status_expiresAt_idx"
  ON "CommercialPreparedMessage"("status", "expiresAt");
