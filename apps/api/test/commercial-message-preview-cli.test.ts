import { describe, it, expect, vi } from 'vitest';
import { runCommercialMessagePreviewCli } from '../src/commercial-message-preview-cli';

describe('CommercialMessagePreviewCli', () => {
  const fixedNow = new Date('2026-08-01T10:00:00.000Z');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createMockCandidate = (overrides = {}): any => ({
    id: 'candidate-1',
    productId: 'prod-1',
    snapshotId: 'snap-1',
    generatedCopyId: 'copy-1',
    status: 'COPY_READY',
    expiresAt: null,
    product: {
      id: 'prod-1',
      unavailableAt: null,
      affiliateLink: 'https://shope.ee/link',
      urlImagem: 'https://shopee.com/image.jpg',
      commercialSnapshotRevision: 1,
    },
    snapshot: {
      id: 'snap-1',
      productId: 'prod-1',
      revision: 1,
      unavailableAt: null,
      offerEndsAt: null,
    },
    generatedCopy: {
      id: 'copy-1',
      productId: 'prod-1',
      snapshotId: 'snap-1',
      createdFromCandidateId: 'candidate-1',
      titulo: 'Oferta incrivel!',
      mensagem: 'Compre agora mesmo.',
      cta: 'Buy now\nhttps://shope.ee/link',
      hashtags: '#teste #shopee',
    },
    ...overrides,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createMockPrisma = (mockCandidate: any) => ({
    commercialPromotionCandidate: {
      findUnique: vi.fn().mockResolvedValue(mockCandidate),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
    },
    $disconnect: vi.fn().mockResolvedValue(undefined),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runCli = async (args: string[], mockPrisma: any, extraDeps = {}) => {
    let stdoutOutput = '';
    let stderrOutput = '';
    const deps = {
      config: { DATABASE_URL: 'postgres://localhost' },
      prisma: mockPrisma,
      stdout: (msg: string) => { stdoutOutput += msg + '\n'; },
      stderr: (msg: string) => { stderrOutput += msg + '\n'; },
      now: () => fixedNow,
      ...extraDeps,
    };
    await runCommercialMessagePreviewCli(args, deps);
    return { stdoutOutput, stderrOutput };
  };

  it('1. candidato COPY_READY com imagem', async () => {
    const prisma = createMockPrisma(createMockCandidate());
    const { stdoutOutput, stderrOutput } = await runCli(['--candidate-id=candidate-1'], prisma);
    
    expect(stderrOutput).toBe('');
    const result = JSON.parse(stdoutOutput);
    expect(result.eligible).toBe(true);
    expect(result.deliveryMode).toBe('IMAGE');
    expect(result.imagePresent).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.blockers).toEqual([]);
    
    // 11. nenhuma operacao de escrita
    expect(prisma.commercialPromotionCandidate.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.commercialPromotionCandidate.update).not.toHaveBeenCalled();
  });

  it('2. imagem ausente fallback para TEXT', async () => {
    const candidate = createMockCandidate();
    candidate.product.urlImagem = '';
    const prisma = createMockPrisma(candidate);
    const { stdoutOutput, stderrOutput } = await runCli(['--candidate-id=candidate-1'], prisma);
    
    expect(stderrOutput).toBe('');
    const result = JSON.parse(stdoutOutput);
    expect(result.eligible).toBe(true);
    expect(result.deliveryMode).toBe('TEXT');
    expect(result.imagePresent).toBe(false);
    expect(result.warnings).toContain('COMMERCIAL_MESSAGE_IMAGE_MISSING');
    expect(result.blockers).toEqual([]);
  });

  it('3. candidato sem copy', async () => {
    const candidate = createMockCandidate();
    candidate.generatedCopyId = null;
    candidate.generatedCopy = null;
    const prisma = createMockPrisma(candidate);
    const { stdoutOutput } = await runCli(['--candidate-id=candidate-1'], prisma);
    
    const result = JSON.parse(stdoutOutput);
    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain('COMMERCIAL_MESSAGE_COPY_MISSING');
  });

  it('4. relacoes inconsistentes', async () => {
    const candidate = createMockCandidate();
    candidate.snapshotId = 'another';
    const prisma = createMockPrisma(candidate);
    const { stdoutOutput } = await runCli(['--candidate-id=candidate-1'], prisma);
    
    const result = JSON.parse(stdoutOutput);
    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain('COMMERCIAL_MESSAGE_RELATION_MISMATCH');
  });

  it('5. snapshot expirado', async () => {
    const candidate = createMockCandidate();
    candidate.snapshot.offerEndsAt = new Date('2026-07-01T00:00:00Z');
    const prisma = createMockPrisma(candidate);
    const { stdoutOutput } = await runCli(['--candidate-id=candidate-1'], prisma);
    
    const result = JSON.parse(stdoutOutput);
    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain('COMMERCIAL_MESSAGE_SNAPSHOT_EXPIRED');
  });

  it('6. Prisma interno: disconnect chamado', async () => {
    const prisma = createMockPrisma(createMockCandidate());
    const prismaFactory = vi.fn().mockReturnValue(prisma);
    const config = { DATABASE_URL: 'postgres://localhost' };
    
    // We do NOT pass prisma in deps, we pass prismaFactory
    await runCommercialMessagePreviewCli(['--candidate-id=candidate-1'], {
      config,
      prismaFactory,
      stdout: () => {},
      stderr: () => {},
      now: () => fixedNow,
    });
    
    expect(prismaFactory).toHaveBeenCalledWith('postgres://localhost');
    expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('7. Prisma injetado: disconnect nao chamado', async () => {
    const prisma = createMockPrisma(createMockCandidate());
    const prismaFactory = vi.fn();
    
    await runCommercialMessagePreviewCli(['--candidate-id=candidate-1'], {
      config: { DATABASE_URL: 'postgres://localhost' },
      prisma,
      prismaFactory,
      stdout: () => {},
      stderr: () => {},
      now: () => fixedNow,
    });
    
    expect(prismaFactory).not.toHaveBeenCalled();
    expect(prisma.$disconnect).not.toHaveBeenCalled();
  });

  it('8. erro durante consulta: disconnect interno chamado', async () => {
    const prisma = createMockPrisma(createMockCandidate());
    prisma.commercialPromotionCandidate.findUnique.mockRejectedValue(new Error('DB falhou'));
    const prismaFactory = vi.fn().mockReturnValue(prisma);
    
    let stderrOutput = '';
    await runCommercialMessagePreviewCli(['--candidate-id=candidate-1'], {
      config: { DATABASE_URL: 'postgres://localhost' },
      prismaFactory,
      stdout: () => {},
      stderr: (msg: string) => { stderrOutput += msg; },
      now: () => fixedNow,
    });
    
    expect(stderrOutput).toContain('Erro na execucao do preview');
    expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('9. CLI: erros de parse', async () => {
    // Missing candidate id
    let stderrOutput = '';
    await runCommercialMessagePreviewCli([], { 
      config: { DATABASE_URL: 'postgres://localhost' },
      stderr: (msg) => { stderrOutput += msg; } 
    });
    expect(stderrOutput).toContain('Uso: pnpm commercial:message:preview');

    // Unknown argument
    stderrOutput = '';
    await runCommercialMessagePreviewCli(['--unknown=1'], { 
      config: { DATABASE_URL: 'postgres://localhost' },
      stderr: (msg) => { stderrOutput += msg; } 
    });
    expect(stderrOutput).toContain('Argumentos invalidos');

    // Duplicate argument
    stderrOutput = '';
    await runCommercialMessagePreviewCli(['--candidate-id=1', '--candidate-id=2'], { 
      config: { DATABASE_URL: 'postgres://localhost' },
      stderr: (msg) => { stderrOutput += msg; } 
    });
    expect(stderrOutput).toContain('Argumento duplicado');
  });

  it('10. --payload sanitizado', async () => {
    const prisma = createMockPrisma(createMockCandidate());
    const { stdoutOutput } = await runCli(['--candidate-id=candidate-1', '--payload'], prisma);
    
    const result = JSON.parse(stdoutOutput);
    expect(result.payloadPreview).toBeDefined();
    
    const payload = result.payloadPreview;
    expect(payload.endpointKind).toBe('sendMedia');
    expect(payload.method).toBe('POST');
    expect(payload.destinationPresent).toBe(true);
    expect(payload.bodyKeys.sort()).toEqual(['caption', 'media', 'mediatype', 'number']);
    
    // Ensures real destination, caption, URL are not printed
    expect(stdoutOutput).not.toContain('5511999999999');
    expect(stdoutOutput).not.toContain('Oferta incrivel');
    expect(stdoutOutput).not.toContain('https://shopee.com/image.jpg');
  });

  it('11. --payload TEXT usa exatamente o contrato sendText sem imageUrl', async () => {
    const candidate = createMockCandidate();
    candidate.product.urlImagem = '';
    const prisma = createMockPrisma(candidate);
    const { stdoutOutput } = await runCli(
      ['--candidate-id=candidate-1', '--payload'],
      prisma,
    );

    const result = JSON.parse(stdoutOutput);
    expect(result.deliveryMode).toBe('TEXT');
    expect(result.imagePresent).toBe(false);
    expect(result.payloadPreview).toMatchObject({
      endpointKind: 'sendText',
      method: 'POST',
      deliveryMode: 'TEXT',
      destinationPresent: true,
      imagePresent: false,
    });
    expect(result.payloadPreview.bodyKeys.sort()).toEqual(['number', 'text']);
    expect(stdoutOutput).not.toContain('5511999999999');
    expect(stdoutOutput).not.toContain('https://shope.ee/link');
  });
});
