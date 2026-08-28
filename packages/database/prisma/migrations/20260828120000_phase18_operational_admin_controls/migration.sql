ALTER TABLE "WhatsAppDestination"
ADD COLUMN "paused" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "WhatsAppInstance"
ADD COLUMN "paused" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CommercialAutomationSettings"
ADD COLUMN "dailyGlobalLimit" INTEGER,
ADD COLUMN "dailyGroupLimit" INTEGER;
