ALTER TABLE "CommercialPreparedMessage"
  ADD COLUMN "preparationRevision" INTEGER NOT NULL DEFAULT 1;

DROP INDEX "CommercialPreparedMessage_campaignId_candidateId_snapshotId_groupDestinationId_instanceName_scheduleRevision_assignmentRevision_key";

CREATE UNIQUE INDEX "CommercialPreparedMessage_campaignId_candidateId_snapshotId_groupDestinationId_instanceName_scheduleRevision_assignmentRevision_preparationRevision_key"
  ON "CommercialPreparedMessage"("campaignId", "candidateId", "snapshotId", "groupDestinationId", "instanceName", "scheduleRevision", "assignmentRevision", "preparationRevision");
