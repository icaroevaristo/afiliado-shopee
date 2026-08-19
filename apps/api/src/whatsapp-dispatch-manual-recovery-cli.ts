import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import {
  createRedisConnection,
  createWhatsAppDispatchQueue,
} from '@shopee-auto-affiliate-ai/queue';
import { PrismaWhatsAppDispatchManualRecoveryRepository } from './prisma-whatsapp-dispatch-manual-recovery-repository';
import {
  WhatsAppDispatchManualRecoveryService,
  type ManualRecoveryJobState,
} from './whatsapp-dispatch-manual-recovery-service';
import {
  WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION,
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

if (
  (action !== 'authorize' && action !== 'requeue') ||
  !dispatchId ||
  !expectedRunId ||
  !expectedExecutionId ||
  confirmation !== WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION
) {
  throw new Error(
    'Usage: <authorize|requeue> --dispatch-id=... --run-id=... --execution-id=... --confirmation=CONFIRMAR_NAO_ENTREGA_E_RETRY_UNICO',
  );
}

const input: WhatsAppDispatchManualRecoveryInput = {
  dispatchId,
  expectedRunId,
  expectedExecutionId,
  confirmation: WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION,
};

const prisma = createPrismaClient();
const repository = new PrismaWhatsAppDispatchManualRecoveryRepository(prisma);

const main = async () => {
  if (action === 'authorize') {
    const service = new WhatsAppDispatchManualRecoveryService(repository, {
      getJob: async () => null,
      findEquivalentJobIds: async () => [],
    });
    const result = await service.authorizeAndRearm(input);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const config = loadConfig();
  const connection = createRedisConnection(config.REDIS_URL);
  const queue = createWhatsAppDispatchQueue(connection);
  try {
    const service = new WhatsAppDispatchManualRecoveryService(
      repository,
      {
        findEquivalentJobIds: async (dispatchId) => {
          const jobs = await queue.getJobs([
            'waiting',
            'active',
            'delayed',
            'failed',
            'completed',
            'paused',
          ]);
          return jobs
            .filter((job) => {
              const data = job.data as { dispatchId?: unknown };
              return data.dispatchId === dispatchId;
            })
            .map((job) => String(job.id));
        },
        getJob: async (jobId) => {
          const job = await queue.getJob(jobId);
          if (!job) return null;
          return {
            id: String(job.id),
            get attemptsMade() {
              return job.attemptsMade;
            },
            getState: async () => {
              const state = await job.getState();
              return (
                [
                  'failed',
                  'waiting',
                  'active',
                  'delayed',
                  'completed',
                  'paused',
                ].includes(state)
                  ? state
                  : 'unknown'
              ) as ManualRecoveryJobState;
            },
            retry: async () => {
              await job.retry();
            },
          };
        },
      },
      { reservationLeaseMs: config.COMMERCIAL_EXECUTION_LEASE_SECONDS * 1000 },
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
