-- Phase 16: persistent registry for real category IDs observed from Shopee offers.
-- This migration is structural only. Existing ProductLead.categoryIds stay untouched.
CREATE TABLE "ShopeeCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "parentId" TEXT,
    "mappingSource" TEXT NOT NULL DEFAULT 'OFFICIAL_PRODUCT_CATEGORY_ID',
    "discoveredAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopeeCategory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShopeeCategory_name_idx" ON "ShopeeCategory"("name");
CREATE INDEX "ShopeeCategory_parentId_idx" ON "ShopeeCategory"("parentId");
