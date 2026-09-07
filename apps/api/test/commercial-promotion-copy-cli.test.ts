import { describe, expect, it, vi } from 'vitest';

import {
  assertCommercialPromotionCopyGenerateEnvironment,
  executeCommercialPromotionCopyCli,
  parseCommercialPromotionCopyCliArgs,
} from '../src/commercial-promotion-copy-cli';

const safeEnvironment = () => ({
  ci: false,
  databaseUrl: 'postgresql://local@127.0.0.1:5432/test',
  fallbackAvailable: true,
  automationMode: 'preview' as const,
  automationEnabled: false,
  automationPaused: true,
  schedulerEnabled: false,
  commercialSchedulerEnabled: false,
  groupSendEnabled: false,
  dispatchWorkers: 0,
});

describe('commercial promotion copy CLI', () => {
  it('aceita separador pnpm e somente as flags documentadas', () => {
    expect(
      parseCommercialPromotionCopyCliArgs('preview', [
        '--',
        '--candidate-id=candidate-internal',
      ]),
    ).toEqual({ mode: 'preview', candidateId: 'candidate-internal' });
    expect(
      parseCommercialPromotionCopyCliArgs('generate', [
        '--confirm-one-ai-copy',
        '--candidate-id=candidate-internal',
      ]),
    ).toEqual({ mode: 'generate', candidateId: 'candidate-internal' });
  });

  it.each([
    ['preflight', ['--extra']],
    ['preview', ['candidate-internal']],
    ['preview', ['--candidate-id=https://example.invalid']],
    ['generate', ['--candidate-id=candidate-internal']],
    [
      'generate',
      [
        '--candidate-id=candidate-internal',
        '--candidate-id=duplicate',
        '--confirm-one-ai-copy',
      ],
    ],
    [
      'generate',
      ['--candidate-id=candidate-internal', '--confirm-one-ai-copy', '--extra'],
    ],
  ] as const)('rejeita argumentos inválidos em %s', (mode, args) => {
    expect(() => parseCommercialPromotionCopyCliArgs(mode, args)).toThrow();
  });

  it('bloqueia todo estado operacional inseguro antes do serviço', () => {
    const unsafe = [
      { ci: true },
      { databaseUrl: 'postgresql://remote@example.com:5432/prod' },
      { fallbackAvailable: false },
      { automationMode: 'send' as const },
      { automationEnabled: true },
      { automationPaused: false },
      { schedulerEnabled: true },
      { commercialSchedulerEnabled: true },
      { groupSendEnabled: true },
      { dispatchWorkers: 1 },
    ];
    for (const override of unsafe) {
      expect(() =>
        assertCommercialPromotionCopyGenerateEnvironment({
          ...safeEnvironment(),
          ...override,
        }),
      ).toThrow();
    }
  });

  it('preview é read-only e generate usa a confirmação interna após guardrails', async () => {
    const service = {
      preflight: vi.fn(() => ({ approved: false })),
      preview: vi.fn(async () => ({ sanitizedPreview: '[LINK_AFILIADO]' })),
      generate: vi.fn(async () => ({ status: 'COPY_READY' })),
    };
    await expect(
      executeCommercialPromotionCopyCli({
        mode: 'preview',
        args: ['--candidate-id=candidate-internal'],
        service: service as never,
      }),
    ).resolves.toEqual({ sanitizedPreview: '[LINK_AFILIADO]' });
    expect(service.generate).not.toHaveBeenCalled();

    await expect(
      executeCommercialPromotionCopyCli({
        mode: 'generate',
        args: ['--candidate-id=candidate-internal', '--confirm-one-ai-copy'],
        service: service as never,
        environment: safeEnvironment(),
      }),
    ).resolves.toEqual({ status: 'COPY_READY' });
    expect(service.generate).toHaveBeenCalledWith(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
  });
});
