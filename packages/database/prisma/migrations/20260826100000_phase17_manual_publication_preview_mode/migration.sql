CREATE TYPE "ManualPublicationRequestMode" AS ENUM ('PREVIEW', 'SEND');

ALTER TYPE "ManualPublicationRequestStatus" ADD VALUE 'PREVIEW_READY';

ALTER TABLE "ManualPublicationRequest"
  ADD COLUMN "mode" "ManualPublicationRequestMode" NOT NULL DEFAULT 'SEND';
