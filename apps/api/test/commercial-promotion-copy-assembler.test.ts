import { describe, expect, it } from 'vitest';

import { commercialAiCopyInputFingerprint } from '../src/commercial-ai-copy-fingerprint';
import {
  CommercialPromotionCopyAssembler,
  cleanCommercialPromotionBody,
  isSafeAssembledCommercialPromotionCopy,
  sanitizeCommercialPromotionCopy,
  validateTrustedGroupInviteUrl,
} from '../src/commercial-promotion-copy-assembler';
import type { CommercialPromotionCopyTrustedFacts } from '../src/commercial-promotion-copy-assembler';

const output = {
  headline: 'Oferta confiável',
  body: 'Uma escolha prática para sua rotina.',
};

const base = {
  output,
  productName: 'Produto Exato',
  shopName: 'Loja Exata',
  price: '123.4500',
  discountRate: 15,
  promotionSignals: [
    'PRICE_DROP',
    'DISCOUNT_INCREASE',
    'NEWLY_OBSERVED',
  ] as const,
  priceDropPercent: '12.3400',
  affiliateLink: 'https://example.invalid/affiliate/exact',
  maximumLength: 1000,
};

describe('CommercialPromotionCopyAssembler', () => {
  const assembler = new CommercialPromotionCopyAssembler();

  const trustedFacts = (
    overrides: Partial<CommercialPromotionCopyTrustedFacts> = {},
  ): CommercialPromotionCopyTrustedFacts => ({
    productName: base.productName,
    shopName: base.shopName,
    price: base.price,
    discountRate: base.discountRate,
    promotionSignals: [...base.promotionSignals],
    priceDropPercent: base.priceDropPercent,
    ...overrides,
  });

  it('ignora CTA criativo da IA e insere fatos e link deterministicamente', () => {
    const copy = assembler.assemble({
      ...base,
      promotionSignals: [...base.promotionSignals],
    });
    expect(copy.titulo).toBe(output.headline);
    expect(copy.mensagem).toBe(
      `${output.body}\n🔥 POR: R$ 123,45\n💸 15% OFF`,
    );
    expect(copy.mensagem).not.toContain('Produto Exato');
    expect(copy.mensagem).not.toContain('Loja Exata');
    expect(copy.mensagem).not.toContain('Queda de');
    expect(copy.mensagem).not.toContain('medição anterior');
    expect(copy.mensagem).not.toContain('DE R$');
    expect(copy.cta).toBe(`🛒 Compre aqui: ${base.affiliateLink}`);
    expect(copy.cta).not.toContain('Confira os detalhes');
    expect(copy.cta.split(base.affiliateLink)).toHaveLength(2);
    expect(copy.hashtags).toBe('');
    expect(copy.hashtags).not.toContain(base.affiliateLink);
    expect(
      sanitizeCommercialPromotionCopy(copy, base.affiliateLink).cta,
    ).toContain('[LINK_AFILIADO]');
  });

  it('preserva exatamente um link válido mesmo quando a URL canônica difere', () => {
    const affiliateLink = 'https://EXAMPLE.invalid/Affiliate';
    const copy = assembler.assemble({
      ...base,
      affiliateLink,
      promotionSignals: [],
    });
    expect(copy.cta).toBe(`🛒 Compre aqui: ${affiliateLink}`);
  });

  it.each(['HOKON.br', 'Loja HOKON.br', 'Produto oficial HOKON.br'])(
    'aceita %s como texto confiável sem expô-lo na ficha pública',
    (value) => {
      for (const field of ['productName', 'shopName'] as const) {
        const facts = trustedFacts({ [field]: value, promotionSignals: [] });
        const copy = assembler.assemble({ ...base, ...facts });
        const sanitized = sanitizeCommercialPromotionCopy(
          copy,
          base.affiliateLink,
        );
        const message = [copy.titulo, copy.mensagem, copy.cta, copy.hashtags].join(
          '\n',
        );

        expect(copy.mensagem).not.toContain(value);
        expect(sanitized.mensagem).not.toContain(value);
        expect(sanitized.mensagem).not.toContain('[LINK_REMOVIDO]');
        expect(message.split(base.affiliateLink)).toHaveLength(2);
        expect(
          isSafeAssembledCommercialPromotionCopy(
            copy,
            base.affiliateLink,
            facts,
            base.maximumLength,
          ),
        ).toBe(true);
      }
    },
  );

  it('sanitiza por allowlist e remove links antigos defensivamente', () => {
    const copy = assembler.assemble({
      ...base,
      affiliateLink: 'https://old.example/path',
      promotionSignals: [],
    });
    const sanitized = sanitizeCommercialPromotionCopy(
      {
        ...copy,
        inputFingerprint: 'must-not-leak',
        snapshotId: 'must-not-leak',
      } as typeof copy,
      'https://current.example/path',
    );
    expect(Object.keys(sanitized).sort()).toEqual([
      'cta',
      'hashtags',
      'mensagem',
      'titulo',
    ]);
    expect(JSON.stringify(sanitized)).not.toContain('must-not-leak');
    expect(sanitized.cta).toContain('[LINK_REMOVIDO]');
    expect(sanitized.cta).not.toContain('old.example');
  });

  it.each([
    ['DISCOUNT_INCREASE'],
    ['NEWLY_OBSERVED'],
    ['CURRENT_DISCOUNT'],
  ] as const)('não expõe o sinal %s no texto público', (signal) => {
      const copy = assembler.assemble({
        ...base,
        promotionSignals: [signal],
        priceDropPercent: null,
        discountRate: signal === 'CURRENT_DISCOUNT' ? 5 : 0,
      });
      expect(copy.mensagem).not.toContain('medição anterior');
      expect(copy.mensagem).not.toContain('recém-observada');
      expect(copy.mensagem).not.toContain('aumentou');
    });

  it('usa somente o preço atual e o desconto oficial quando não há preço original', () => {
    const copy = assembler.assemble({
      ...base,
      price: '49.90',
      discountRate: 0,
      promotionSignals: [],
      priceDropPercent: null,
    });

    expect(copy.mensagem).toBe(`${output.body}\n🔥 POR: R$ 49,90`);
    expect(copy.mensagem).not.toContain('DE R$');
    expect(copy.mensagem).not.toContain('OFF');
  });

  it('monta o exemplo comercial com POR, CTA novo e convite confiável', () => {
    const input = {
      ...base,
      output: {
        headline: 'CACHEADOR DE BOLSO',
        body: 'Modelador de Cabelo GOKOCO com Íons Negativos',
      },
      price: '189.00',
      discountRate: 47.5,
      promotionSignals: [],
      priceDropPercent: null,
      affiliateLink: 'https://s.shopee.com.br/abc',
      groupInviteUrl: 'https://chat.whatsapp.com/xyz',
    };
    const copy = assembler.assemble(input);

    expect(copy).toEqual({
      titulo: 'CACHEADOR DE BOLSO',
      mensagem:
        'Modelador de Cabelo GOKOCO com Íons Negativos\n🔥 POR: R$ 189,00\n💸 47,5% OFF',
      cta: '🛒 Compre aqui: https://s.shopee.com.br/abc',
      hashtags:
        '📎 Encaminhe para um amigo participar do grupo: https://chat.whatsapp.com/xyz',
    });
    expect(
      isSafeAssembledCommercialPromotionCopy(
        copy,
        input.affiliateLink,
        input,
        input.maximumLength,
      ),
    ).toBe(true);
  });

  it('mantém o núcleo da copy e altera somente o assembly quando o invite muda', () => {
    const input = {
      ...base,
      output: {
        headline: 'CACHEADOR DE BOLSO',
        body: 'Modelador de Cabelo GOKOCO com Íons Negativos',
      },
      price: '189.00',
      discountRate: 47.5,
      promotionSignals: [],
      priceDropPercent: null,
      affiliateLink: 'https://s.shopee.com.br/abc',
    };
    const first = assembler.assemble({
      ...input,
      groupInviteUrl: 'https://chat.whatsapp.com/xyz',
    });
    const second = assembler.assemble({
      ...input,
      groupInviteUrl: 'https://chat.whatsapp.com/abc',
    });

    expect(second.titulo).toBe(first.titulo);
    expect(second.mensagem).toBe(first.mensagem);
    expect(second.cta).toBe(first.cta);
    expect(second.hashtags).not.toBe(first.hashtags);
  });

  it('usa somente o preço atual e nunca trata priceMax como preço original', () => {
    const copy = assembler.assemble({
      ...base,
      price: '189.00',
      promotionSignals: [],
      priceDropPercent: null,
    });
    expect(copy.mensagem).toContain('🔥 POR: R$ 189,00');
    expect(copy.mensagem).not.toContain('DE:');
  });

  it('omite completamente o rodapé quando o invite está ausente ou inválido', () => {
    for (const groupInviteUrl of [
      undefined,
      null,
      'http://chat.whatsapp.com/xyz',
      'https://chat.whatsapp.co/xyz',
      'https://evil.example/xyz',
      'javascript:alert(1)',
      'https://chat.whatsapp.com/',
      'https://chat.whatsapp.com/xyz?redirect=https://evil.example',
      'https://chat.whatsapp.com:443/xyz',
      ' https://chat.whatsapp.com/xyz',
      'https://chat.whatsapp.com/xyz ',
      'https://chat.whatsapp.com/xyz/',
    ]) {
      const copy = assembler.assemble({
        ...base,
        groupInviteUrl,
        promotionSignals: [],
      });
      expect(copy.hashtags).toBe('');
      expect(copy.cta).toBe(`🛒 Compre aqui: ${base.affiliateLink}`);
      expect(validateTrustedGroupInviteUrl(groupInviteUrl)).toBeNull();
    }
  });

  it('conta affiliate e invite confiáveis separadamente e rejeita duplicação', () => {
    const facts = trustedFacts({
      price: '189.00',
      discountRate: 47.5,
      groupInviteUrl: 'https://chat.whatsapp.com/xyz',
      promotionSignals: [],
      priceDropPercent: null,
    });
    const copy = assembler.assemble({
      ...base,
      ...facts,
      output: {
        headline: 'CACHEADOR DE BOLSO',
        body: 'Modelador de Cabelo GOKOCO com Íons Negativos',
      },
      affiliateLink: 'https://s.shopee.com.br/abc',
    });
    expect(
      isSafeAssembledCommercialPromotionCopy(
        copy,
        'https://s.shopee.com.br/abc',
        facts,
        base.maximumLength,
      ),
    ).toBe(true);
    expect(
      isSafeAssembledCommercialPromotionCopy(
        { ...copy, hashtags: `${copy.hashtags} ${facts.groupInviteUrl}` },
        'https://s.shopee.com.br/abc',
        facts,
        base.maximumLength,
      ),
    ).toBe(false);
  });

  it('não aceita cache com CTA diferente ou body acima do limite', () => {
    const facts = trustedFacts({ promotionSignals: [], priceDropPercent: null });
    const affiliateLink = 'https://s.shopee.com.br/abc';
    const copy = assembler.assemble({
      ...base,
      ...facts,
      output: {
        headline: 'CACHEADOR DE BOLSO',
        body: 'Modelador de Cabelo GOKOCO com Íons Negativos',
      },
      affiliateLink,
    });

    expect(
      isSafeAssembledCommercialPromotionCopy(
        { ...copy, cta: `Outro CTA ${copy.cta.slice(copy.cta.indexOf(' '))}` },
        affiliateLink,
        facts,
        base.maximumLength,
      ),
    ).toBe(false);
    expect(
      isSafeAssembledCommercialPromotionCopy(
        {
          ...copy,
          mensagem: `${'x'.repeat(101)}\n${copy.mensagem.slice(copy.mensagem.indexOf('\n') + 1)}`,
        },
        affiliateLink,
        facts,
        base.maximumLength,
      ),
    ).toBe(false);
  });

  it.each([
    [
      'Tênis de Corrida com Placa de Carbono Profissional 33-44',
      'Tênis de Corrida com Placa de Carbono Profissional',
    ],
    ['Sapato Social 34-39', 'Sapato Social'],
    ['Roupa Esportiva 36-42', 'Roupa Esportiva'],
    ['Air Fryer 6,5L 1700W 127V', 'Air Fryer 6,5L 1700W 127V'],
    ['Dove Sérum 380ml', 'Dove Sérum 380ml'],
    ['Intelbras FR 102', 'Intelbras FR 102'],
    ['Kit Ferramentas 46 Peças', 'Kit Ferramentas 46 Peças'],
    ['Produto Modelo 33-44', 'Produto Modelo 33-44'],
  ])('limpa somente faixas de tamanho com contexto inequívoco: %s', (body, expected) => {
    expect(cleanCommercialPromotionBody(body)).toBe(expected);
  });

  it('aplica cleanup idempotente antes de persistir e ao sanitizar uma copy cacheada', () => {
    const body = 'Tênis de Corrida com Placa de Carbono Profissional 33-44';
    const cleaned = cleanCommercialPromotionBody(body);
    const copy = assembler.assemble({
      ...base,
      output: { headline: 'SOLA QUE PARECE JET!', body },
      promotionSignals: [],
    });
    const cached = sanitizeCommercialPromotionCopy(
      {
        ...copy,
        mensagem: `${body}\n🔥 POR: R$ 123,45\n💸 15% OFF`,
      },
      base.affiliateLink,
    );

    expect(cleanCommercialPromotionBody(cleaned)).toBe(cleaned);
    expect(copy.titulo).toBe('SOLA QUE PARECE JET!');
    expect(copy.mensagem).toBe(`${cleaned}\n🔥 POR: R$ 123,45\n💸 15% OFF`);
    expect(cached.mensagem).toBe(`${cleaned}\n🔥 POR: R$ 123,45\n💸 15% OFF`);
    expect(copy.cta).toBe(`🛒 Compre aqui: ${base.affiliateLink}`);
    expect(copy.hashtags).toBe('');
    expect([copy.titulo, copy.mensagem, copy.cta, copy.hashtags].join('\n').split(base.affiliateLink)).toHaveLength(2);
  });

  it.each([
    'custom://evil.example',
    'https://evil.example',
    'http://evil.example',
    'www.evil.example',
    'https://evil.example/path',
    'https://evil.example/path?x=1',
    'https://evil.example/#fragment',
    'evil.example/path',
    'evil.example?x=1',
    'evil.example#fragment',
    'example.com:8080/path',
  ])('rejeita URL navegável em cada fato confiável: %s', (url) => {
    for (const field of ['productName', 'shopName'] as const) {
      expect(() =>
        assembler.assemble({
          ...base,
          [field]: `${field} ${url}`,
          promotionSignals: [],
        }),
      ).toThrowError(
        expect.objectContaining({ code: 'COMMERCIAL_AI_COPY_URL_INVALID' }),
      );
    }
  });

  it.each([
    'https://evil.example',
    'www.evil.example',
    'example.com',
  ])('rejeita URL na saída da IA: %s', (url) => {
    expect(() =>
      assembler.assemble({
        ...base,
        output: { ...output, body: `Veja ${url}` },
        promotionSignals: [],
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'COMMERCIAL_AI_COPY_URL_INVALID' }),
    );
  });

  it('ignora CTA legado da IA, mantém CTA determinístico e rejeita tamanho sem truncar', () => {
    const copy = assembler.assemble({
      ...base,
      output: {
        ...output,
        cta: `CTA legado\n${base.affiliateLink}`,
      } as unknown as typeof output,
      promotionSignals: [],
    });
    expect(copy.cta).toBe(`🛒 Compre aqui: ${base.affiliateLink}`);
    expect([copy.titulo, copy.mensagem, copy.cta, copy.hashtags].join('\n').split(base.affiliateLink)).toHaveLength(2);
    expect(() =>
      assembler.assemble({ ...base, promotionSignals: [], maximumLength: 20 }),
    ).toThrowError(
      expect.objectContaining({ code: 'COMMERCIAL_AI_COPY_TOO_LONG' }),
    );
  });

  it.each([
    ['LF', '\n'],
    ['CR', '\r'],
    ['tab', '\t'],
    ['NUL', '\u0000'],
    ['DEL', '\u007F'],
  ])('rejeita link afiliado com controle ASCII %s antes de montar a copy', (_name, control) => {
    const affiliateLink = `https://example.invalid/affiliate${control}https://evil.example/second`;

    expect(() =>
      assembler.assemble({
        ...base,
        affiliateLink,
        promotionSignals: [],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'COMMERCIAL_AI_COPY_AFFILIATE_LINK_REQUIRED',
      }),
    );
  });

  it('valida cache com HOKON.br e falha fechado para URL navegável em fato confiável', () => {
    const facts = trustedFacts({ shopName: 'HOKON.br', promotionSignals: [] });
    const copy = assembler.assemble({ ...base, ...facts });

    expect(
      isSafeAssembledCommercialPromotionCopy(
        copy,
        base.affiliateLink,
        facts,
        base.maximumLength,
      ),
    ).toBe(true);

    const unsafeFacts = trustedFacts({
      shopName: 'https://evil.example',
      promotionSignals: [],
    });
    const unsafeCopy = {
      ...copy,
      mensagem: copy.mensagem.replace('HOKON.br', 'https://evil.example'),
    };
    expect(
      isSafeAssembledCommercialPromotionCopy(
        unsafeCopy,
        base.affiliateLink,
        unsafeFacts,
        base.maximumLength,
      ),
    ).toBe(false);
  });

  it('falha fechado no cache para link afiliado com segunda URL após LF', () => {
    const facts = trustedFacts({ promotionSignals: [] });
    const copy = assembler.assemble({ ...base, ...facts });

    expect(
      isSafeAssembledCommercialPromotionCopy(
        copy,
        `${base.affiliateLink}\nhttps://evil.example/second`,
        facts,
        base.maximumLength,
      ),
    ).toBe(false);
  });
});

describe('commercialAiCopyInputFingerprint', () => {
  const input = {
    promptVersion: 'commercial-promotion-copy-v1',
    validationVersion: 'commercial-promotion-copy-validation-v1',
    inputSanitizationVersion: 'commercial-promotion-copy-input-sanitization-v1',
    modelProductName: 'Produto',
    provider: 'openai',
    model: 'selected-model',
    campaignId: 'campaign-internal',
    nicheId: 'niche-internal',
    candidateId: 'candidate-internal',
    productId: 'product-internal',
    snapshotId: 'snapshot-internal',
    snapshotRevision: 2,
    snapshotFingerprint: 'snapshot-fingerprint',
    promotionSignals: ['PRICE_DROP', 'CURRENT_DISCOUNT'] as const,
    priceDropPercent: '12.3400',
    productName: 'Produto',
    shopName: 'Loja',
    price: '123.4500',
    discountRate: 15,
    affiliateLink: 'https://example.invalid/affiliate/exact',
    maximumLength: 1000,
  };

  it('é determinístico e não contém fatos de montagem nem o link bruto', () => {
    const first = commercialAiCopyInputFingerprint({
      ...input,
      promotionSignals: [...input.promotionSignals],
    });
    const second = commercialAiCopyInputFingerprint({
      ...input,
      price: ' 000123.4500 ',
      priceDropPercent: '12.34',
      promotionSignals: [...input.promotionSignals].reverse(),
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain(input.affiliateLink);
  });

  it('ignora productUpdatedAt operacional', () => {
    const atFirstSync = {
      ...input,
      productUpdatedAt: new Date('2026-08-01T12:00:00Z'),
      promotionSignals: [...input.promotionSignals],
    };
    const atSecondSync = {
      ...input,
      productUpdatedAt: new Date('2026-08-01T12:00:01Z'),
      promotionSignals: [...input.promotionSignals],
    };
    expect(commercialAiCopyInputFingerprint(atSecondSync)).toBe(
      commercialAiCopyInputFingerprint(atFirstSync),
    );
  });

  it('mantém o fingerprint em sync idêntico com lastSeenAt operacional diferente', () => {
    const firstSync = {
      ...input,
      lastSeenAt: new Date('2026-08-01T12:00:00Z'),
      promotionSignals: [...input.promotionSignals],
    };
    const secondSync = {
      ...input,
      lastSeenAt: new Date('2026-08-01T12:00:01Z'),
      promotionSignals: [...input.promotionSignals],
    };
    expect(commercialAiCopyInputFingerprint(secondSync)).toBe(
      commercialAiCopyInputFingerprint(firstSync),
    );
  });

  it('ignora score, rating, sales e timestamps voláteis removidos do contrato', () => {
    expect(
      commercialAiCopyInputFingerprint({
        ...input,
        commercialScore: 80,
        rating: 4.8,
        sales: 500,
        campaignUpdatedAt: new Date('2026-08-01T12:00:00Z'),
        nicheUpdatedAt: new Date('2026-08-01T12:00:00Z'),
        promotionSignals: [...input.promotionSignals],
      } as Parameters<typeof commercialAiCopyInputFingerprint>[0]),
    ).toBe(
      commercialAiCopyInputFingerprint({
        ...input,
        commercialScore: 99,
        rating: 1.1,
        sales: 99999,
        campaignUpdatedAt: new Date('2030-01-01T00:00:00Z'),
        nicheUpdatedAt: new Date('2030-01-01T00:00:00Z'),
        promotionSignals: [...input.promotionSignals],
      } as Parameters<typeof commercialAiCopyInputFingerprint>[0]),
    );
  });

  it('ignora fatos exclusivos da montagem e da publicação', () => {
    const first = commercialAiCopyInputFingerprint(input);
    const changedAssemblyFacts = commercialAiCopyInputFingerprint({
      ...input,
      promotionSignals: ['NEWLY_OBSERVED'],
      priceDropPercent: '13',
      productName: 'Produto alterado',
      shopName: 'Loja alterada',
      price: '124.45',
      discountRate: 16,
      affiliateLink: 'https://example.invalid/affiliate/changed',
      maximumLength: 999,
    });
    expect(changedAssemblyFacts).toBe(first);
  });

  it('mantém o contrato AI quando somente a revisão do snapshot muda', () => {
    const first = commercialAiCopyInputFingerprint(input);
    const changedSnapshot = commercialAiCopyInputFingerprint({
      ...input,
      snapshotId: 'snapshot-changed',
      snapshotRevision: 3,
      snapshotFingerprint: 'snapshot-fingerprint-changed',
    });
    expect(changedSnapshot).toBe(first);
  });

  it('ignora whitespace ou controle exclusivo do artefato de montagem', () => {
    const raw = { productName: 'Produto\u0000  exato', shopName: 'Loja\tExata' };
    const changed = { productName: 'Produto  exato', shopName: 'Loja Exata' };
    const assembler = new CommercialPromotionCopyAssembler();
    const rawCopy = assembler.assemble({
      ...base,
      ...raw,
      promotionSignals: [],
    });
    const changedCopy = assembler.assemble({
      ...base,
      ...changed,
      promotionSignals: [],
    });
    expect(rawCopy.mensagem).toBe(changedCopy.mensagem);
    expect(
      commercialAiCopyInputFingerprint({
        ...input,
        ...raw,
        promotionSignals: [...input.promotionSignals],
      }),
    ).toBe(
      commercialAiCopyInputFingerprint({
        ...input,
        ...changed,
        promotionSignals: [...input.promotionSignals],
      }),
    );
  });

  it.each([
    ['promptVersion', { promptVersion: 'commercial-promotion-copy-v2' }],
    [
      'validationVersion',
      { validationVersion: 'commercial-promotion-copy-validation-v2' },
    ],
    [
      'inputSanitizationVersion',
      { inputSanitizationVersion: 'commercial-promotion-copy-input-sanitization-v2' },
    ],
    ['modelProductName', { modelProductName: 'Produto sanitizado' }],
    ['provider', { provider: 'other-provider' }],
    ['model', { model: 'other-model' }],
    ['campaignId', { campaignId: 'campaign-changed' }],
    ['nicheId', { nicheId: 'niche-changed' }],
    ['candidateId', { candidateId: 'candidate-changed' }],
    ['productId', { productId: 'product-changed' }],
  ] as const)(
    'muda quando o input semântico %s muda',
    (_field, change) => {
      const first = commercialAiCopyInputFingerprint({
        ...input,
        promotionSignals: [...input.promotionSignals],
      });
      const changed = commercialAiCopyInputFingerprint({
        ...input,
        ...change,
        promotionSignals: [...input.promotionSignals],
      });
      expect(changed).not.toBe(first);
    },
  );

  it('separa fingerprints de validação v1, v2 e v3 sem alterar o histórico', () => {
    const v1 = commercialAiCopyInputFingerprint({
      ...input,
      validationVersion: 'commercial-promotion-copy-validation-v1',
      promotionSignals: [...input.promotionSignals],
    });
    const v2 = commercialAiCopyInputFingerprint({
      ...input,
      validationVersion: 'commercial-promotion-copy-validation-v2',
      promotionSignals: [...input.promotionSignals],
    });
    const v3 = commercialAiCopyInputFingerprint({
      ...input,
      validationVersion: 'commercial-promotion-copy-validation-v3',
      promotionSignals: [...input.promotionSignals],
    });
    expect(v2).not.toBe(v1);
    expect(v3).not.toBe(v2);
    expect(
      commercialAiCopyInputFingerprint({
        ...input,
        validationVersion: 'commercial-promotion-copy-validation-v2',
        promotionSignals: [...input.promotionSignals],
      }),
    ).toBe(v2);
    expect(
      commercialAiCopyInputFingerprint({
        ...input,
        validationVersion: 'commercial-promotion-copy-validation-v3',
        promotionSignals: [...input.promotionSignals],
      }),
    ).toBe(v3);
  });

  it('separa fingerprints de prompt v4, v5, v6, v7 e v8 mantendo as versões históricas', () => {
    const promptV4 = commercialAiCopyInputFingerprint({
      ...input,
      promptVersion: 'commercial-promotion-copy-v4',
      validationVersion: 'commercial-promotion-copy-validation-v2',
      promotionSignals: [...input.promotionSignals],
    });
    const promptV5 = commercialAiCopyInputFingerprint({
      ...input,
      promptVersion: 'commercial-promotion-copy-v5',
      validationVersion: 'commercial-promotion-copy-validation-v2',
      promotionSignals: [...input.promotionSignals],
    });
    const promptV6 = commercialAiCopyInputFingerprint({
      ...input,
      promptVersion: 'commercial-promotion-copy-v6',
      validationVersion: 'commercial-promotion-copy-validation-v3',
      promotionSignals: [...input.promotionSignals],
    });
    const promptV7 = commercialAiCopyInputFingerprint({
      ...input,
      promptVersion: 'commercial-promotion-copy-v7',
      validationVersion: 'commercial-promotion-copy-validation-v3',
      promotionSignals: [...input.promotionSignals],
    });
    const promptV8 = commercialAiCopyInputFingerprint({
      ...input,
      promptVersion: 'commercial-promotion-copy-v8',
      validationVersion: 'commercial-promotion-copy-validation-v4',
      promotionSignals: [...input.promotionSignals],
    });
    expect(promptV5).not.toBe(promptV4);
    expect(promptV6).not.toBe(promptV5);
    expect(promptV7).not.toBe(promptV6);
    expect(promptV8).not.toBe(promptV7);
    expect(
      commercialAiCopyInputFingerprint({
        ...input,
        promptVersion: 'commercial-promotion-copy-v5',
        validationVersion: 'commercial-promotion-copy-validation-v2',
        promotionSignals: [...input.promotionSignals],
      }),
    ).toBe(promptV5);
    expect(
      commercialAiCopyInputFingerprint({
        ...input,
        promptVersion: 'commercial-promotion-copy-v6',
        validationVersion: 'commercial-promotion-copy-validation-v3',
        promotionSignals: [...input.promotionSignals],
      }),
    ).toBe(promptV6);
    expect(
      commercialAiCopyInputFingerprint({
        ...input,
        promptVersion: 'commercial-promotion-copy-v7',
        validationVersion: 'commercial-promotion-copy-validation-v3',
        promotionSignals: [...input.promotionSignals],
      }),
    ).toBe(promptV7);
    expect(
      commercialAiCopyInputFingerprint({
        ...input,
        promptVersion: 'commercial-promotion-copy-v8',
        validationVersion: 'commercial-promotion-copy-validation-v4',
        promotionSignals: [...input.promotionSignals],
      }),
    ).toBe(promptV8);
  });

  it('separa o fingerprint histórico V10 do contrato V11', () => {
    const promptV10 = commercialAiCopyInputFingerprint({
      ...input,
      promptVersion: 'commercial-promotion-copy-v10',
      validationVersion: 'commercial-promotion-copy-validation-v4',
      promotionSignals: [...input.promotionSignals],
    });
    const promptV11 = commercialAiCopyInputFingerprint({
      ...input,
      promptVersion: 'commercial-promotion-copy-v11',
      validationVersion: 'commercial-promotion-copy-validation-v4',
      promotionSignals: [...input.promotionSignals],
    });

    expect(promptV11).not.toBe(promptV10);
    expect(
      commercialAiCopyInputFingerprint({
        ...input,
        promptVersion: 'commercial-promotion-copy-v11',
        validationVersion: 'commercial-promotion-copy-validation-v4',
        promotionSignals: [...input.promotionSignals],
      }),
    ).toBe(promptV11);
  });

  it('separa V12 de V14 e inclui a versão/texto efetivo enviados ao modelo', () => {
    const v12 = commercialAiCopyInputFingerprint({
      ...input,
      promptVersion: 'commercial-promotion-copy-v12',
      inputSanitizationVersion: 'commercial-promotion-copy-input-sanitization-v0',
      modelProductName: 'Produto original',
      promotionSignals: [...input.promotionSignals],
    });
    const v14 = commercialAiCopyInputFingerprint({
      ...input,
      promptVersion: 'commercial-promotion-copy-v14',
      inputSanitizationVersion: 'commercial-promotion-copy-input-sanitization-v1',
      modelProductName: 'Produto',
      promotionSignals: [...input.promotionSignals],
    });
    const changedModelText = commercialAiCopyInputFingerprint({
      ...input,
      promptVersion: 'commercial-promotion-copy-v14',
      inputSanitizationVersion: 'commercial-promotion-copy-input-sanitization-v1',
      modelProductName: 'Produto com especificação diferente',
      promotionSignals: [...input.promotionSignals],
    });

    expect(v14).not.toBe(v12);
    expect(changedModelText).not.toBe(v14);
  });
});
