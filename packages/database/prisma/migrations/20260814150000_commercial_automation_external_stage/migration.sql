CREATE TYPE "CommercialAutomationExecutionExternalStage" AS ENUM ('NOT_REACHED', 'EXTERNAL_MAY_HAVE_STARTED');

ALTER TABLE "CommercialAutomationExecution"
ADD COLUMN "externalStage" "CommercialAutomationExecutionExternalStage" NOT NULL DEFAULT 'EXTERNAL_MAY_HAVE_STARTED';

ALTER TABLE "CommercialAutomationExecution"
ALTER COLUMN "externalStage" SET DEFAULT 'NOT_REACHED';