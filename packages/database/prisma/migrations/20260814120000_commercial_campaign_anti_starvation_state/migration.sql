-- AlterTable
ALTER TABLE "CommercialGroupCampaign"
  ADD COLUMN "failureCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextEligibleAt" TIMESTAMP(3);
