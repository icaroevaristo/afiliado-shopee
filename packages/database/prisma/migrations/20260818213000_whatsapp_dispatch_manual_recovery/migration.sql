CREATE TYPE "WhatsAppDispatchManualRecoveryDecision" AS ENUM ('CONFIRMED_NON_DELIVERY');

CREATE TABLE "WhatsAppDispatchManualRecovery" (
    "id" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "decision" "WhatsAppDispatchManualRecoveryDecision" NOT NULL,
    "confirmation" TEXT NOT NULL,
    "attemptCountObserved" INTEGER NOT NULL,
    "authorizedAt" TIMESTAMP(3) NOT NULL,
    "rearmedAt" TIMESTAMP(3),
    "requeuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppDispatchManualRecovery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppDispatchManualRecovery_dispatchId_key" ON "WhatsAppDispatchManualRecovery"("dispatchId");
CREATE INDEX "WhatsAppDispatchManualRecovery_runId_idx" ON "WhatsAppDispatchManualRecovery"("runId");
CREATE INDEX "WhatsAppDispatchManualRecovery_executionId_idx" ON "WhatsAppDispatchManualRecovery"("executionId");
CREATE INDEX "WhatsAppDispatchManualRecovery_candidateId_idx" ON "WhatsAppDispatchManualRecovery"("candidateId");
CREATE INDEX "WhatsAppDispatchManualRecovery_campaignId_idx" ON "WhatsAppDispatchManualRecovery"("campaignId");
ALTER TABLE "WhatsAppDispatchManualRecovery" ADD CONSTRAINT "WhatsAppDispatchManualRecovery_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "WhatsAppDispatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
