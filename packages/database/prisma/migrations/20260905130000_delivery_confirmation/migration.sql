-- HTTP acceptance only proves that Evolution accepted a submission. Delivery
-- evidence is recorded separately from MESSAGES_UPDATE events.
ALTER TYPE "WhatsAppDispatchStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE "WhatsAppDispatchStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "WhatsAppDispatchStatus" ADD VALUE IF NOT EXISTS 'READ';
ALTER TYPE "WhatsAppDispatchStatus" ADD VALUE IF NOT EXISTS 'AMBIGUOUS';

ALTER TABLE "WhatsAppDispatch"
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "confirmationDeadlineAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "readAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "WhatsAppDispatch_status_confirmationDeadlineAt_idx"
  ON "WhatsAppDispatch"("status", "confirmationDeadlineAt");

-- This is intentionally non-unique: historical SENT rows can share an
-- external id. The consumer refuses ambiguous correlations rather than
-- rewriting history or confirming the wrong dispatch.
CREATE INDEX IF NOT EXISTS "WhatsAppDispatch_instanceName_externalMessageId_idx"
  ON "WhatsAppDispatch"("instanceName", "externalMessageId");

-- Webhooks can arrive before the worker persists externalMessageId. Keep a
-- compact, idempotent inbox so that event evidence is drained after the
-- submission association exists. Raw provider payloads and JIDs are not
-- stored.
CREATE TYPE "WhatsAppDeliveryEventStatus" AS ENUM (
  'PENDING',
  'SERVER_ACK',
  'DELIVERY_ACK',
  'READ',
  'ERROR'
);

CREATE TYPE "WhatsAppDeliveryEventInboxState" AS ENUM (
  'PENDING',
  'APPLIED',
  'AMBIGUOUS'
);

CREATE TABLE "WhatsAppDeliveryEventInbox" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "instanceName" TEXT NOT NULL,
  "externalMessageId" TEXT NOT NULL,
  "status" "WhatsAppDeliveryEventStatus" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "state" "WhatsAppDeliveryEventInboxState" NOT NULL DEFAULT 'PENDING',
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WhatsAppDeliveryEventInbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppDeliveryEventInbox_fingerprint_key"
  ON "WhatsAppDeliveryEventInbox"("fingerprint");

CREATE INDEX "WhatsAppDeliveryEventInbox_instanceName_externalMessageId_state_occurredAt_idx"
  ON "WhatsAppDeliveryEventInbox"("instanceName", "externalMessageId", "state", "occurredAt");

CREATE INDEX "WhatsAppDeliveryEventInbox_state_occurredAt_idx"
  ON "WhatsAppDeliveryEventInbox"("state", "occurredAt");
