ALTER TABLE "CommercialAutomationSettings"
ADD COLUMN "dailyShopeeHttpLimit" INTEGER,
ADD COLUMN "dailyOpenAiGenerationLimit" INTEGER;

ALTER TABLE "CommercialAutomationSettings"
ADD CONSTRAINT "CommercialAutomationSettings_dailyShopeeHttpLimit_positive"
CHECK ("dailyShopeeHttpLimit" IS NULL OR "dailyShopeeHttpLimit" > 0),
ADD CONSTRAINT "CommercialAutomationSettings_dailyOpenAiGenerationLimit_positive"
CHECK ("dailyOpenAiGenerationLimit" IS NULL OR "dailyOpenAiGenerationLimit" > 0);

CREATE TABLE "CommercialExternalProviderUsage" (
    "provider" VARCHAR(16) NOT NULL,
    "dayKey" VARCHAR(10) NOT NULL,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommercialExternalProviderUsage_pkey" PRIMARY KEY ("provider", "dayKey"),
    CONSTRAINT "CommercialExternalProviderUsage_provider_valid" CHECK ("provider" IN ('SHOPEE', 'OPENAI')),
    CONSTRAINT "CommercialExternalProviderUsage_usedCount_nonnegative" CHECK ("usedCount" >= 0)
);

CREATE INDEX "CommercialExternalProviderUsage_dayKey_idx"
ON "CommercialExternalProviderUsage"("dayKey");
