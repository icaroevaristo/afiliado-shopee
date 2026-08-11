import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { buildAuthenticatedTestApp } from './authenticated-test-app';

const apps: Array<Awaited<ReturnType<typeof buildAuthenticatedTestApp>>> = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

const setup = async () => {
  const preview = vi.fn(async () => ({
    candidateId: 'candidate-internal',
    eligible: true,
    sanitizedPreview: { cta: '[LINK_AFILIADO]' },
  }));
  const generate = vi.fn(async () => ({
    candidateId: 'candidate-internal',
    generatedCopyId: 'copy-internal',
    status: 'COPY_READY',
    sanitizedCopy: { cta: '[LINK_AFILIADO]' },
  }));
  const findCopy = vi.fn(async () => ({
    candidateId: 'candidate-internal',
    generatedCopyId: 'copy-internal',
    source: 'AI',
    sanitizedCopy: { cta: '[LINK_AFILIADO]' },
  }));
  const app = await buildAuthenticatedTestApp({
    logger: false,
    prisma: {} as never,
    commercialPromotionCopyService: {
      preflight: vi.fn(),
      preview,
      generate,
      findCopy,
    } as never,
    whatsappDispatchQueue: { add: vi.fn(), getJob: vi.fn() },
  });
  apps.push(app);
  return { app, preview, generate, findCopy };
};

describe('commercial promotion copy routes', () => {
  it('aceita preview sem body ou com objeto vazio e rejeita campos', async () => {
    const subject = await setup();
    for (const payload of [undefined, {}]) {
      const response = await subject.app.inject({
        method: 'POST',
        url: '/commercial/promotion-candidates/candidate-internal/copy-preview',
        ...(payload ? { payload } : {}),
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.stringify(response.json())).not.toContain('https://');
    }
    const invalid = await subject.app.inject({
      method: 'POST',
      url: '/commercial/promotion-candidates/candidate-internal/copy-preview',
      payload: { extra: true },
    });
    expect(invalid.statusCode).toBe(400);
    const nullBody = await subject.app.inject({
      method: 'POST',
      url: '/commercial/promotion-candidates/candidate-internal/copy-preview',
      headers: { 'content-type': 'application/json' },
      payload: 'null',
    });
    expect(nullBody.statusCode).toBe(400);
    expect(subject.preview).toHaveBeenCalledTimes(2);
  });

  it('exige body estrito e confirmação exata para gerar', async () => {
    const subject = await setup();
    const success = await subject.app.inject({
      method: 'POST',
      url: '/commercial/promotion-candidates/candidate-internal/copy-generate',
      payload: { confirm: 'GERAR_COPY_COM_IA' },
    });
    expect(success.statusCode).toBe(200);
    expect(subject.generate).toHaveBeenCalledWith(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
    for (const payload of [
      {},
      { confirm: 'errado' },
      { confirm: 'GERAR_COPY_COM_IA', extra: true },
      [],
    ]) {
      const response = await subject.app.inject({
        method: 'POST',
        url: '/commercial/promotion-candidates/candidate-internal/copy-generate',
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it('retorna copy sanitizada e mapeia erros sem detalhe bruto', async () => {
    const subject = await setup();
    const found = await subject.app.inject({
      method: 'GET',
      url: '/commercial/promotion-candidates/candidate-internal/copy',
    });
    expect(found.statusCode).toBe(200);
    expect(JSON.stringify(found.json())).not.toContain('https://');

    subject.generate.mockRejectedValueOnce(
      new AppError('Output rejeitado', 'COMMERCIAL_AI_COPY_OUTPUT_INVALID'),
    );
    const rejected = await subject.app.inject({
      method: 'POST',
      url: '/commercial/promotion-candidates/candidate-internal/copy-generate',
      payload: { confirm: 'GERAR_COPY_COM_IA' },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toEqual({
      error: 'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
      message: 'Output rejeitado',
    });
  });

  it('mapeia códigos sanitizados do provider para status HTTP estáveis', async () => {
    const subject = await setup();
    const cases = [
      ['COMMERCIAL_AI_COPY_AUTHENTICATION_FAILED', 503],
      ['COMMERCIAL_AI_COPY_ACCESS_DENIED', 503],
      ['COMMERCIAL_AI_COPY_QUOTA_EXCEEDED', 503],
      ['COMMERCIAL_AI_COPY_RATE_LIMITED', 503],
      ['COMMERCIAL_AI_COPY_PROVIDER_SERVER_ERROR', 503],
    ] as const;

    for (const [code, statusCode] of cases) {
      subject.generate.mockRejectedValueOnce(
        new AppError('Provider falhou', code),
      );
      const response = await subject.app.inject({
        method: 'POST',
        url: '/commercial/promotion-candidates/candidate-internal/copy-generate',
        payload: { confirm: 'GERAR_COPY_COM_IA' },
      });
      expect(response.statusCode).toBe(statusCode);
      expect(response.json()).toEqual({
        error: code,
        message: 'Provider falhou',
      });
    }
  });
});
