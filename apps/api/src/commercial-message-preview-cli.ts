import { parseArgs } from 'node:util';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import { CommercialMessageDraftService } from './commercial-message-draft-service';
import { buildEvolutionMessagePayload } from '@shopee-auto-affiliate-ai/providers';
import { fileURLToPath } from 'node:url';

export type CommercialMessagePreviewCliDeps = {
  config?: { DATABASE_URL: string };
  prisma?: unknown;
  prismaFactory?: (url: string) => unknown;
  draftService?: CommercialMessageDraftService;
  payloadBuilder?: typeof buildEvolutionMessagePayload;
  stdout?: (msg: string) => void;
  stderr?: (msg: string) => void;
  now?: () => Date;
};

export async function runCommercialMessagePreviewCli(
  args: string[],
  deps: CommercialMessagePreviewCliDeps = {},
) {
  const stdout = deps.stdout ?? ((msg) => console.log(msg));
  const stderr = deps.stderr ?? ((msg) => console.error(msg));

  let parsed: ReturnType<typeof parseArgs>;
  const cleanArgs = args.filter((arg) => arg !== '--');
  try {
    parsed = parseArgs({
      options: {
        'candidate-id': { type: 'string', multiple: true },
        payload: { type: 'boolean', multiple: true },
      },
      args: cleanArgs,
      strict: true,
    });
  } catch {
    stderr('Argumentos invalidos');
    return;
  }

  const { values } = parsed;

  if (Array.isArray(values['candidate-id']) && values['candidate-id'].length > 1) {
    stderr('Argumento duplicado: --candidate-id');
    return;
  }
  if (Array.isArray(values.payload) && values.payload.length > 1) {
    stderr('Argumento duplicado: --payload');
    return;
  }

  const candidateIdStr = Array.isArray(values['candidate-id']) ? values['candidate-id'][0] : values['candidate-id'];
  const payloadBool = Array.isArray(values.payload) ? values.payload[0] : values.payload;

  const candidateId = typeof candidateIdStr === 'string' ? candidateIdStr : undefined;
  const payloadRequested = typeof payloadBool === 'boolean' ? payloadBool : false;

  if (!candidateId) {
    stderr('Uso: pnpm commercial:message:preview -- --candidate-id=<ID> [--payload]');
    return;
  }

  let config;
  try {
    config = deps.config ?? loadConfig();
  } catch {
    stderr('Erro ao carregar configuracao');
    return;
  }

  const draftService = deps.draftService ?? new CommercialMessageDraftService();
  const payloadBuilder = deps.payloadBuilder ?? buildEvolutionMessagePayload;
  const now = deps.now ?? (() => new Date());

  const prismaFactory = deps.prismaFactory ?? createPrismaClient;
  const injectedPrisma = !!deps.prisma;
  const prisma = (deps.prisma ?? prismaFactory(config.DATABASE_URL)) as import('@shopee-auto-affiliate-ai/database').DatabaseClient;

  try {
    const candidate = await prisma.commercialPromotionCandidate.findUnique({
      where: { id: candidateId },
      include: {
        product: true,
        generatedCopy: true,
        snapshot: true,
      },
    });

    if (!candidate) {
      stdout(
        JSON.stringify(
          {
            candidateId,
            eligible: false,
            blockers: ['Candidato nao existe'],
          },
          null,
          2,
        ),
      );
      return;
    }

    let draft: ReturnType<typeof draftService.createDraft> | undefined;
    let eligible = true;
    const blockers: string[] = [];

    try {
      draft = draftService.createDraft(candidate, { now });
    } catch (err: unknown) {
      eligible = false;
      blockers.push(err instanceof Error ? err.message : String(err));
    }

    const result: Record<string, unknown> = {
      candidateId,
      eligible,
      deliveryMode: draft?.deliveryMode ?? null,
      imagePresent: !!draft?.imageUrl,
      copyPresent: !!candidate.generatedCopyId,
      affiliateLinkPresent: !!candidate.product?.affiliateLink,
      captionLength: draft?.caption?.length ?? 0,
      warnings: draft?.warnings ?? [],
      blockers: eligible ? [] : blockers,
    };

    if (payloadRequested && draft) {
      // builder usado somente para preview
      // nao executa HTTP
      // integracao de sendMedia com guardrails sera tarefa futura
      const payloadPreview = payloadBuilder({
        baseUrl: 'https://evolution-mock.local',
        instanceName: 'test-instance',
        destination: '5511999999999',
        deliveryMode: draft.deliveryMode,
        caption: draft.caption,
        imageUrl: draft.imageUrl,
      });
      const parsedBody = JSON.parse(payloadPreview.body);
      const isMedia = payloadPreview.url.includes('/message/sendMedia/');
      
      result.payloadPreview = {
        endpointKind: isMedia ? 'sendMedia' : 'sendText',
        method: payloadPreview.method,
        deliveryMode: draft.deliveryMode,
        bodyKeys: Object.keys(parsedBody),
        destinationPresent: !!parsedBody.number,
        captionLength: draft.caption.length,
        imagePresent: !!draft.imageUrl,
      };
    }

    stdout(JSON.stringify(result, null, 2));
  } catch {
    stderr('Erro na execucao do preview');
  } finally {
    if (!injectedPrisma) {
      await prisma.$disconnect();
    }
  }
}

if (process.argv[1] && import.meta.url.startsWith('file:') && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCommercialMessagePreviewCli(process.argv.slice(2)).catch(() => {
    console.error('Erro fatal no preview');
    process.exit(1);
  });
}
