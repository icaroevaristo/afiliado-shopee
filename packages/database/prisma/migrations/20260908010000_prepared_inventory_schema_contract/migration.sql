-- Prisma owns updatedAt; preparation expiry must be explicitly supplied.
-- This forward repair preserves existing rows and the historical indexes.
ALTER TABLE "CommercialDiscoveryCheckpoint" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "CommercialPreparedMessage"
  ALTER COLUMN "updatedAt" DROP DEFAULT,
  ALTER COLUMN "expiresAt" DROP DEFAULT;
