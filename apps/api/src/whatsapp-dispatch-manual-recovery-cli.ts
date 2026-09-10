import { createWhatsAppDispatchManualRecoveryQueue } from './whatsapp-dispatch-manual-recovery-queue';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import {
  createRedisConnection,
  createWhatsAppDispatchQueue,
} from '@shopee-auto-affiliate-ai/queue';
import { PrismaWhatsAppDispatchManualRecoveryRepository } from './prisma-whatsapp-dispatch-manual-recovery-repository';
import {
  createCommercialAutomationPolicyService,
  createPrismaRepositories,
} from './application-services';
import { WhatsAppDispatchManualRecoveryService } from './whatsapp-dispatch-manual-recovery-service';
import {
  WHATSAPP_DISPATCH_AMBIGUITY_NO_RETRY_CONFIRMATION,
  WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION,
  type WhatsAppDispatchAmbiguityNoRetryInput,
  type WhatsAppDispatchManualRecoveryInput,
} from './repositories';

const readArg = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
};

const action = process.argv[2];
const dispatchId = readArg('dispatch-id');
const expectedRunId = readArg('run-id');
const expectedExecutionId = readArg('execution-id');
const confirmation = readArg('confirmation');

const isNoRetryCloseout = action === 'close-ambiguity-no-retry';
const expectedConfirmation = isNoRetryCloseout
  ? WHATSAPP_DISPATCH_AMBIGUITY_NO_RETRY_CONFIRMATION
  : WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION;

if (
  (!isNoRetryCloseout && action !== 'authorize' && action !== 'requeue') ||
  !dispatchId ||
  !expectedRunId ||
  !expectedExecutionId ||
  confirmation !== expectedConfirmation
) {
  throw new Error(
    'Usage: <authorize|requeue|close-ambiguity-no-retry> --dispatch-id=... --run-id=... --execution-id=... --confirmation=<literal da acao>',
  );
}

const prisma = createPrismaClient();
const repository = new PrismaWhatsAppDispatchManualRecoveryRepository(prisma);

const main = async () => {
  if (isNoRetryCloseout) {
    const input: WhatsAppDispatchAmbiguityNoRetryInput = {
      dispatchId,
      expectedRunId,
      expectedExecutionId,
      confirmation: WHATSAPP_DISPATCH_AMBIGUITY_NO_RETRY_CONFIRMATION,
    };
    const service = new WhatsAppDispatchManualRecoveryService(repository);
    const result = await service.closeAmbiguityWithoutRetry(input);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const input: WhatsAppDispatchManualRecoveryInput = {
    dispatchId,
    expectedRunId,
    expectedExecutionId,
    confirmation: WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION,
  };
  if (action === 'authorize') {
    const service = new WhatsAppDispatchManualRecoveryService(repository);
    const result = await service.authorize(input);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const config = loadConfig();
  if (!config.EVOLUTION_INSTANCE_NAME) {
    throw new Error(
      'EVOLUTION_INSTANCE_NAME is required for manual recovery requeue',
    );
  }
  const applicationRepositories = createPrismaRepositories(prisma);
  const policy = createCommercialAutomationPolicyService({
    repositories: applicationRepositories,
    instanceName: config.EVOLUTION_INSTANCE_NAME,
    config: {
      enabled: config.COMMERCIAL_AUTOMATION_ENABLED,
      timezone: config.COMMERCIAL_TIMEZONE,
      allowedStartTime: config.COMMERCIAL_ALLOWED_START_TIME,
      allowedEndTime: config.COMMERCIAL_ALLOWED_END_TIME,
      dailyGlobalLimit: config.COMMERCIAL_DAILY_GLOBAL_LIMIT,
      dailyGroupLimit: config.COMMERCIAL_DAILY_GROUP_LIMIT,
      minimumIntervalMinutes: config.COMMERCIAL_MIN_INTERVAL_MINUTES,
    },
  });
  const connection = createRedisConnection(config.REDIS_URL);
  const queue = createWhatsAppDispatchQueue(connection);
  try {
    const service = new WhatsAppDispatchManualRecoveryService(
      repository,
      createWhatsAppDispatchManualRecoveryQueue(queue),
      { reservationLeaseMs: config.COMMERCIAL_EXECUTION_LEASE_SECONDS * 1000 },
      policy,
    );
    const result = await service.requeueAuthorizedRetry(input);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await queue.close();
    await connection.quit();
  }
};

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
