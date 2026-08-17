ALTER TABLE "CommercialPipelineRun"
ADD COLUMN "executionId" TEXT;

CREATE UNIQUE INDEX "CommercialPipelineRun_executionId_key"
ON "CommercialPipelineRun"("executionId");
