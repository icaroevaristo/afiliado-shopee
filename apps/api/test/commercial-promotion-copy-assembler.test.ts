import { describe, expect, it } from 'vitest';

import { commercialAiCopyInputFingerprint } from '../src/commercial-ai-copy-fingerprint';
import {
  CommercialPromotionCopyAssembler,
  isSafeAssembledCommercialPromotionCopy,
  sanitizeCommercialPromotionCopy,
} from '../src/commercial-promotion-copy-assembler';

const output = {
  headline: 'Oferta confiável',
  body: 'Uma escolha prática para sua rotina.',
  cta: 'Confira os detalhes',
  hashtags: ['#Oferta', '#Casa'],
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

  const trustedFacts = (overrides = {}) => ({
    productName: base.productName,
    shopName: base.shopName,
    price: base.price,
    discountRate: base.discountRate,
    promotionSignals: [...base.promotionSignals],
    priceDropPercent: base.priceDropPercent,
    ...overrides,
  });

  it('insere fatos e link deterministicamente com prioridade do sinal', () => {
    const copy = assembler.assemble({
      ...base,
      promotionSignals: [...base.promotionSignals],
    });
    expect(copy.titulo).toBe(output.headline);
    expect(copy.mensagem).toContain('📦 Produto: Produto Exato');
    expect(copy.mensagem).toContain('🏪 Loja: Loja Exata');
    expect(copy.mensagem).toContain('💰 Preço: R$ 123,45');
    expect(copy.mensagem).toContain('💸 Desconto: 15%');
    expect(copy.mensagem).toContain('Queda de 12,34%');
    expect(copy.mensagem).not.toContain('O desconto informado aumentou');
    expect(copy.cta.split(base.affiliateLink)).toHaveLength(2);
    expect(copy.hashtags).toBe('#Oferta #Casa');
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
    expect(copy.cta).toBe(`${output.cta}\n${affiliateLink}`);
  });

  it.each(['HOKON.br', 'Loja HOKON.br', 'Produto oficial HOKON.br'])(
    'preserva %s em cada fato confiável sem sanitizá-lo como link',
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

        expect(copy.mensagem).toContain(value);
        expect(sanitized.mensagem).toContain(value);
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
    [['DISCOUNT_INCREASE'], 'O desconto informado aumentou'],
    [['NEWLY_OBSERVED'], 'recém-observada pelo nosso sistema'],
    [['CURRENT_DISCOUNT'], null],
  ] as const)(
    'monta sinal %s sem afirmação extra indevida',
    (signals, phrase) => {
      const copy = assembler.assemble({
        ...base,
        promotionSignals: [...signals],
        priceDropPercent: null,
        discountRate: signals[0] === 'CURRENT_DISCOUNT' ? 5 : 0,
      });
      if (phrase) expect(copy.mensagem).toContain(phrase);
      else expect(copy.mensagem).not.toContain('medição anterior');
    },
  );

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

  it('rejeita link afiliado duplicado e tamanho sem truncar', () => {
    expect(() =>
      assembler.assemble({
        ...base,
        output: { ...output, cta: `${output.cta}\n${base.affiliateLink}` },
        promotionSignals: [],
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'COMMERCIAL_AI_COPY_URL_INVALID' }),
    );
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
    provider: 'openai',
    model: 'selected-model',
    campaignId: 'campaign-internal',
    campaignUpdatedAt: new Date('2026-08-01T12:00:00Z'),
    nicheId: 'niche-internal',
    nicheUpdatedAt: new Date('2026-08-01T12:00:00Z'),
    candidateId: 'candidate-internal',
    productId: 'product-internal',
    snapshotId: 'snapshot-internal',
    snapshotRevision: 2,
    snapshotFingerprint: 'snapshot-fingerprint',
    commercialScore: 80,
    promotionSignals: ['PRICE_DROP', 'CURRENT_DISCOUNT'] as const,
    priceDropPercent: '12.3400',
    productName: 'Produto',
    shopName: 'Loja',
    price: '123.4500',
    discountRate: 15,
    rating: 4.8,
    sales: 500,
    affiliateLink: 'https://example.invalid/affiliate/exact',
    maximumLength: 1000,
  };

  it('é determinístico, canonicaliza sinais e preço equivalente do assembler sem conter o link bruto', () => {
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

  it.each([
    [
      'productName',
      'Produto ' + 'x'.repeat(250) + ' A',
      'Produto ' + 'x'.repeat(250) + ' B',
    ],
    [
      'shopName',
      'Loja ' + 'x'.repeat(120) + ' A',
      'Loja ' + 'x'.repeat(120) + ' B',
    ],
  ] as const)('muda quando %s muda após o limite antigo', (field, firstValue, secondValue) => {
    const first = commercialAiCopyInputFingerprint({
      ...input,
      [field]: firstValue,
      promotionSignals: [...input.promotionSignals],
    });
    const second = commercialAiCopyInputFingerprint({
      ...input,
      [field]: secondValue,
      promotionSignals: [...input.promotionSignals],
    });
    expect(second).not.toBe(first);
  });

  it('muda quando whitespace ou controle altera o artefato cru do assembler', () => {
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
    expect(rawCopy.mensagem).not.toBe(changedCopy.mensagem);
    expect(
      commercialAiCopyInputFingerprint({
        ...input,
        ...raw,
        promotionSignals: [...input.promotionSignals],
      }),
    ).not.toBe(
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
    ['provider', { provider: 'other-provider' }],
    ['model', { model: 'other-model' }],
    ['campaignId', { campaignId: 'campaign-changed' }],
    ['campaignUpdatedAt', { campaignUpdatedAt: new Date('2026-08-01T12:00:01Z') }],
    ['nicheId', { nicheId: 'niche-changed' }],
    ['nicheUpdatedAt', { nicheUpdatedAt: new Date('2026-08-01T12:00:01Z') }],
    ['candidateId', { candidateId: 'candidate-changed' }],
    ['productId', { productId: 'product-changed' }],
    ['snapshotId', { snapshotId: 'snapshot-changed' }],
    ['snapshotRevision', { snapshotRevision: 3 }],
    ['snapshotFingerprint', { snapshotFingerprint: 'snapshot-fingerprint-changed' }],
    ['commercialScore', { commercialScore: 81 }],
    ['promotionSignals', { promotionSignals: ['NEWLY_OBSERVED'] }],
    ['priceDropPercent', { priceDropPercent: '13' }],
    ['productName', { productName: 'Produto alterado' }],
    ['shopName', { shopName: 'Loja alterada' }],
    ['price', { price: '124.45' }],
    ['discountRate', { discountRate: 16 }],
    ['rating', { rating: 4.7 }],
    ['sales', { sales: 501 }],
    ['affiliateLink', { affiliateLink: 'https://example.invalid/affiliate/changed' }],
    ['maximumLength', { maximumLength: 999 }],
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
        promotionSignals:
          'promotionSignals' in change
            ? [...change.promotionSignals]
            : [...input.promotionSignals],
      });
      expect(changed).not.toBe(first);
    },
  );

  it('separa fingerprints de validação v1 e v2 sem alterar o histórico', () => {
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
    expect(v2).not.toBe(v1);
    expect(
      commercialAiCopyInputFingerprint({
        ...input,
        validationVersion: 'commercial-promotion-copy-validation-v2',
        promotionSignals: [...input.promotionSignals],
      }),
    ).toBe(v2);
  });

  it('separa fingerprints de prompt v1 e v2 mantendo a mesma validationVersion', () => {
    const promptV1 = commercialAiCopyInputFingerprint({
      ...input,
      promptVersion: 'commercial-promotion-copy-v1',
      validationVersion: 'commercial-promotion-copy-validation-v2',
      promotionSignals: [...input.promotionSignals],
    });
    const promptV2 = commercialAiCopyInputFingerprint({
      ...input,
      promptVersion: 'commercial-promotion-copy-v2',
      validationVersion: 'commercial-promotion-copy-validation-v2',
      promotionSignals: [...input.promotionSignals],
    });
    expect(promptV2).not.toBe(promptV1);
    expect(
      commercialAiCopyInputFingerprint({
        ...input,
        promptVersion: 'commercial-promotion-copy-v2',
        validationVersion: 'commercial-promotion-copy-validation-v2',
        promotionSignals: [...input.promotionSignals],
      }),
    ).toBe(promptV2);
  });
});
