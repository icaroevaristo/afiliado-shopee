-- AlterTable
ALTER TABLE "CommercialGroupCampaign"
  ADD COLUMN "attemptExecutionId" TEXT,
  ADD COLUMN "attemptReservedAt" TIMESTAMP(3),
  ADD COLUMN "attemptLeaseExpiresAt" TIMESTAMP(3);
