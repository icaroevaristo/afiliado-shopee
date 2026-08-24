ALTER TABLE "CommercialAutomationSettings"
  ADD COLUMN "allowedStartTime" TEXT,
  ADD COLUMN "allowedEndTime" TEXT,
  ADD COLUMN "minimumIntervalMinutes" INTEGER,
  ADD COLUMN "staggerMinutes" INTEGER,
  ADD COLUMN "scheduleRevision" INTEGER NOT NULL DEFAULT 0;
