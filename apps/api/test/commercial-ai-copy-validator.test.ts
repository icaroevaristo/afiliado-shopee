import { describe, expect, it } from 'vitest';

import {
  COMMERCIAL_AI_COPY_VALIDATION_FAILURE_CODES,
  CommercialAiCopyValidator,
  sanitizeCommercialAiCopyValidationFailureCodes,
} from '../src/commercial-ai-copy-validator';
import { COMMERCIAL_AI_COPY_PROHIBITED_PHRASES } from '../src/commercial-ai-copy-policy';

const valid = {
  headline: 'ACHADO PARA O DIA',
  body: 'Produto seguro para o seu dia.',
};

describe('CommercialAiCopyValidator V6', () => {
  const validator = new CommercialAiCopyValidator();

  it('normaliza e aceita output válido somente com headline e body', () => {
    expect(
      validator.validate(
        {
          ...valid,
          body: '  Produto   seguro para o seu dia.  ',
        },
        'Produto seguro para o seu dia',
        ['Loja Exata'],
      ),
    ).toEqual({
      valid: true,
      sanitizedOutput: valid,
      publicFailureCodes: [],
    });
  });

  it('mantém cada claim proibida da política compartilhada como bloqueio', () => {
    for (const phrase of COMMERCIAL_AI_COPY_PROHIBITED_PHRASES) {
      const result = validator.validate({
        ...valid,
        body: `Mensagem com ${phrase} em destaque.`,
      });
      expect(result.publicFailureCodes).toContain('AI_PROHIBITED_CLAIM');
    }
  });

  it.each([
    [{ ...valid, extra: true }, 'AI_OUTPUT_EXTRA_PROPERTY'],
    [{ ...valid, headline: '' }, 'AI_HEADLINE_LENGTH'],
    [{ ...valid, headline: 'x'.repeat(91) }, 'AI_HEADLINE_LENGTH'],
    [{ ...valid, headline: 'Achado para o dia' }, 'AI_HEADLINE_UPPERCASE'],
    [{ ...valid, headline: 'ACHADO 2 O DIA' }, 'AI_DIGIT_FORBIDDEN'],
    [{ ...valid, body: '' }, 'AI_BODY_LENGTH'],
    [{ ...valid, body: 'x'.repeat(101) }, 'AI_BODY_LENGTH'],
    [{ ...valid, body: 'x'.repeat(261) }, 'AI_BODY_LENGTH'],
    [
      { ...valid, body: 'Veja https://example.invalid agora' },
      'AI_URL_OR_CONTACT_FORBIDDEN',
    ],
    [
      { ...valid, body: 'Escreva para teste@example.com' },
      'AI_URL_OR_CONTACT_FORBIDDEN',
    ],
    [{ ...valid, body: 'Preço R$ especial' }, 'AI_FACTUAL_VALUE_FORBIDDEN'],
    [
      { ...valid, body: 'Desconto de dez % disponível' },
      'AI_FACTUAL_VALUE_FORBIDDEN',
    ],
    [{ ...valid, body: 'Oferta com 9 vantagens' }, 'AI_DIGIT_FORBIDDEN'],
    [{ ...valid, body: 'Frete grátis para sua compra' }, 'AI_PROHIBITED_CLAIM'],
    [{ ...valid, body: 'Últimas unidades no estoque' }, 'AI_PROHIBITED_CLAIM'],
    [
      { ...valid, body: 'Produto original e com garantia' },
      'AI_PROHIBITED_CLAIM',
    ],
    [{ ...valid, body: 'O mais vendido com cashback' }, 'AI_PROHIBITED_CLAIM'],
    [
      { ...valid, body: '✨✨✨✨✨✨✨ Texto confiável e natural' },
      'AI_EMOJI_LIMIT',
    ],
    [
      { ...valid, body: 'Uma [oferta](https://example.invalid)' },
      'AI_URL_OR_CONTACT_FORBIDDEN',
    ],
    [
      { ...valid, body: 'Uma oferta\ncom controle oculto' },
      'AI_CONTROL_CHARACTER',
    ],
    [
      { ...valid, body: 'Confira em exemplo.io agora' },
      'AI_URL_OR_CONTACT_FORBIDDEN',
    ],
    [{ ...valid, body: 'Uma **oferta** confiável' }, 'AI_MARKDOWN_FORBIDDEN'],
    [{ ...valid, body: 'Oferta com dígito de largura total １' }, 'AI_DIGIT_FORBIDDEN'],
  ])('rejeita conteúdo inseguro %#', (output, code) => {
    const result = validator.validate(output);
    expect(result.valid).toBe(false);
    expect(result.publicFailureCodes).toContain(code);
    expect(result).not.toHaveProperty('invalidOutput');
  });

  it.each([
    ['Tênis 33-44', 'Tênis 33-44'],
    ['Garrafa 380ml', 'Garrafa 380 ml'],
    ['Aquecedor 1700W', 'Aquecedor 1700 W'],
    ['Fonte 127V', 'Fonte 127 V'],
    ['Kit 46 Peças', 'Kit com 46 peças'],
    ['Recipiente 6,5L', 'Recipiente 6,5 L'],
    ['Modelo FR 102', 'Modelo FR 102'],
  ] as const)('aceita especificação numérica sustentada: %s', (productName, body) => {
    const result = validator.validate(
      { headline: 'NOME LIMPO', body },
      productName,
    );
    expect(result).toEqual({
      valid: true,
      sanitizedOutput: { headline: 'NOME LIMPO', body },
      publicFailureCodes: [],
    });
  });

  it('rejeita número inventado mesmo quando a unidade parece válida', () => {
    const result = validator.validate(
      { headline: 'NOME LIMPO', body: 'Garrafa 381ml' },
      'Garrafa 380ml',
    );
    expect(result.valid).toBe(false);
    expect(result.publicFailureCodes).toContain('AI_DIGIT_FORBIDDEN');
  });

  it('aceita identidades curtas dos produtos de referência sem relaxar a headline', () => {
    const fixtures = [
      [
        'Kit 3 Regata Feminina Suplex com Alcinha, Modelo Virgínia',
        'Kit 3 Regatas Suplex Modelo Virgínia',
      ],
      [
        'Kit 5 pacotes de Toalhas Umedecidas Baby Free com 100 unidades',
        'Kit 5 Pacotes de Toalhas Umedecidas Baby Free',
      ],
      [
        'Seringa de insulina 0,5ml com agulha ultrafina 0,30mm x 8mm',
        'Seringa de Insulina 0,5ml com Agulha 8mm',
      ],
      [
        'Modelador de cabelo portátil GOKOCO com íons negativos, 9 níveis',
        'Modelador de Cabelo GOKOCO com Íons Negativos',
      ],
      ['Tênis de Corrida com Placa de Carbono', 'Tênis de Corrida com Placa de Carbono'],
      ['Air Fryer 6,5L 1700W 127V', 'Air Fryer 6,5L 1700W 127V'],
    ] as const;
    const validator = new CommercialAiCopyValidator();

    for (const [productName, body] of fixtures) {
      expect(body.length).toBeLessThanOrEqual(100);
      expect(
        validator.validate({ headline: 'ACHADO DO DIA', body }, productName),
      ).toMatchObject({ valid: true, publicFailureCodes: [] });
    }
    expect(
      validator.validate(
        { headline: 'ACHADO 2 DIA', body: 'Tênis de Corrida com Placa de Carbono' },
        fixtures[4][0],
      ).publicFailureCodes,
    ).toContain('AI_DIGIT_FORBIDDEN');
  });

  it('rejeita identidade textual que não existe no nome do produto', () => {
    const result = validator.validate(
      {
        headline: 'AIR FRYER EM DESTAQUE',
        body: 'Air Fryer Marca Fantasma com Bluetooth',
      },
      'Air Fryer 6,5L 1700W 127V',
    );

    expect(result.valid).toBe(false);
    expect(result.publicFailureCodes).toContain('AI_FACTUAL_VALUE_FORBIDDEN');
  });

  it('rejeita corpo genérico sem identidade sustentada pelo produto', () => {
    const result = validator.validate(
      {
        headline: 'OFERTA SEGURA',
        body: 'Uma escolha prática para sua rotina.',
      },
      'Produto verificado',
    );

    expect(result.valid).toBe(false);
    expect(result.publicFailureCodes).toContain('AI_FACTUAL_VALUE_FORBIDDEN');
  });

  it('aceita body no limite exato e rejeita o primeiro caractere excedente', () => {
    const validator = new CommercialAiCopyValidator();
    const atLimit = 'a'.repeat(100);
    expect(
      validator.validate({ headline: 'NOME LIMPO', body: atLimit }).valid,
    ).toBe(true);
    expect(
      validator.validate({ headline: 'NOME LIMPO', body: `${atLimit}a` })
        .publicFailureCodes,
    ).toContain('AI_BODY_LENGTH');
  });

  it('rejeita repetição contextual de fato confiável da loja', () => {
    const result = validator.validate(
      { ...valid, body: 'Loja Exata em destaque no catálogo.' },
      'Produto seguro para o seu dia',
      ['Loja Exata'],
    );
    expect(result.valid).toBe(false);
    expect(result.publicFailureCodes).toContain('AI_CATALOG_FACT_REPEATED');
  });

  it('comprova regressão da falha real simultânea sem campos legados', () => {
    const regression = {
      headline: 'OFERTA CONFIÁVEL',
      body: 'Uma escolha prática para sua rotina 2. ' + 'x'.repeat(250),
    };
    const result = validator.validate(regression);
    expect(result.valid).toBe(false);
    expect(result.publicFailureCodes).toContain('AI_BODY_LENGTH');
    expect(result.publicFailureCodes).toContain('AI_DIGIT_FORBIDDEN');
  });
});

describe('sanitizeCommercialAiCopyValidationFailureCodes', () => {
  it('handles non-arrays', () => {
    expect(sanitizeCommercialAiCopyValidationFailureCodes(undefined)).toEqual([]);
    expect(sanitizeCommercialAiCopyValidationFailureCodes(null)).toEqual([]);
    expect(sanitizeCommercialAiCopyValidationFailureCodes('not array')).toEqual([]);
    expect(sanitizeCommercialAiCopyValidationFailureCodes(123)).toEqual([]);
    expect(sanitizeCommercialAiCopyValidationFailureCodes({})).toEqual([]);
  });

  it('handles empty array', () => {
    expect(sanitizeCommercialAiCopyValidationFailureCodes([])).toEqual([]);
  });

  it('keeps valid codes and removes duplicates and sorts', () => {
    expect(
      sanitizeCommercialAiCopyValidationFailureCodes([
        'AI_OUTPUT_EXTRA_PROPERTY',
        'AI_HEADLINE_LENGTH',
        'AI_OUTPUT_EXTRA_PROPERTY',
      ]),
    ).toEqual(['AI_HEADLINE_LENGTH', 'AI_OUTPUT_EXTRA_PROPERTY']);
  });

  it('removes invalid types or empty or long strings', () => {
    expect(
      sanitizeCommercialAiCopyValidationFailureCodes([
        'AI_HEADLINE_LENGTH',
        '',
        'x'.repeat(101),
        123,
        null,
      ]),
    ).toEqual(['AI_HEADLINE_LENGTH']);
  });

  it('removes unknown codes', () => {
    expect(
      sanitizeCommercialAiCopyValidationFailureCodes([
        'AI_HEADLINE_LENGTH',
        'UNKNOWN_CODE',
      ]),
    ).toEqual(['AI_HEADLINE_LENGTH']);
  });

  it('limits to 20 codes', () => {
    const all = [...COMMERCIAL_AI_COPY_VALIDATION_FAILURE_CODES];
    const limited = sanitizeCommercialAiCopyValidationFailureCodes(all);
    expect(limited.length).toBeLessThanOrEqual(20);
    expect(limited).toEqual(all.sort().slice(0, 20));
  });

  it('does not throw on malformed mixed input', () => {
    expect(() =>
      sanitizeCommercialAiCopyValidationFailureCodes([
        'AI_HEADLINE_LENGTH',
        { foo: 'bar' },
        undefined,
        'UNKNOWN',
      ]),
    ).not.toThrow();
    expect(
      sanitizeCommercialAiCopyValidationFailureCodes([
        'AI_HEADLINE_LENGTH',
        { foo: 'bar' },
        undefined,
        'UNKNOWN',
      ]),
    ).toEqual(['AI_HEADLINE_LENGTH']);
  });
});
