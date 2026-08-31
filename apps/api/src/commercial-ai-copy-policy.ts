export const COMMERCIAL_AI_COPY_PROHIBITED_PHRASES = [
  'frete grátis',
  'cupom',
  'estoque',
  'últimas unidades',
  'só hoje',
  'corre',
  'acaba hoje',
  'tempo limitado',
  'menor preço',
  'preço histórico',
  'garantia',
  'garantido',
  'original',
  'autêntico',
  'loja oficial',
  'vendedor oficial',
  'cashback',
  'desconto extra',
  'entrega hoje',
  'entrega garantida',
  'mais vendido',
  'número um',
  'exclusivo',
  'aproveite antes que acabe',
  'oportunidade única',
] as const;

export const COMMERCIAL_AI_COPY_BODY_MAX_LENGTH = 100;

const COMMERCIAL_AI_COPY_SPECIAL_URGENCY_PHRASES = [
  'só hoje',
  'tempo limitado',
  'acaba hoje',
  'antes que acabe',
] as const;

const POLICY_LETTER = /\p{L}/u;

export type CommercialAiCopyPolicyMatch = {
  phrase: string;
  start: number;
  end: number;
};

export const normalizeCommercialAiCopyPolicyText = (value: string) =>
  value
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR');

const normalizedSourceText = (value: string) =>
  value.normalize('NFKC').replace(/\s+/gu, ' ').trim();

const policyCharacters = (value: string) => {
  const source = normalizedSourceText(value);
  const sourceCharacters = Array.from(source);
  const characters: string[] = [];
  const sourceStarts: number[] = [];
  const sourceEnds: number[] = [];

  sourceCharacters.forEach((character, sourceIndex) => {
    const normalized = Array.from(
      character
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLocaleLowerCase('pt-BR'),
    );
    normalized.forEach((normalizedCharacter) => {
      characters.push(normalizedCharacter);
      sourceStarts.push(sourceIndex);
      sourceEnds.push(sourceIndex + 1);
    });
  });

  return { source, characters, sourceStarts, sourceEnds };
};

const phraseMatches = (
  value: string,
  phrases: readonly string[],
): CommercialAiCopyPolicyMatch[] => {
  const { characters, sourceStarts, sourceEnds } = policyCharacters(value);
  const matches: CommercialAiCopyPolicyMatch[] = [];

  for (const phrase of phrases) {
    const tokens = Array.from(normalizeCommercialAiCopyPolicyText(phrase));
    if (!tokens.length) continue;
    for (
      let index = 0;
      index <= characters.length - tokens.length;
      index += 1
    ) {
      if (
        !tokens.every(
          (token, tokenIndex) => characters[index + tokenIndex] === token,
        )
      ) {
        continue;
      }
      const before = characters[index - 1];
      const after = characters[index + tokens.length];
      if (
        (before && POLICY_LETTER.test(before)) ||
        (after && POLICY_LETTER.test(after))
      ) {
        continue;
      }
      matches.push({
        phrase,
        start: sourceStarts[index],
        end: sourceEnds[index + tokens.length - 1],
      });
    }
  }

  return matches.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start),
  );
};

const hasSpecialUrgency = (value: string) =>
  phraseMatches(value, ['imperdível']).length > 0 &&
  COMMERCIAL_AI_COPY_SPECIAL_URGENCY_PHRASES.some(
    (phrase) => phraseMatches(value, [phrase]).length > 0,
  );

export const findCommercialAiCopyProhibitedClaimMatches = (
  value: string,
): CommercialAiCopyPolicyMatch[] => {
  const matches = phraseMatches(
    value,
    hasSpecialUrgency(value)
      ? [
          ...COMMERCIAL_AI_COPY_PROHIBITED_PHRASES,
          ...COMMERCIAL_AI_COPY_SPECIAL_URGENCY_PHRASES,
        ]
      : COMMERCIAL_AI_COPY_PROHIBITED_PHRASES,
  );
  const selected: CommercialAiCopyPolicyMatch[] = [];
  for (const match of matches) {
    if (
      selected.some(
        (current) => match.start < current.end && current.start < match.end,
      )
    ) {
      continue;
    }
    selected.push(match);
  }
  return selected.sort((left, right) => left.start - right.start);
};

export const hasCommercialAiCopyProhibitedClaim = (value: string) =>
  findCommercialAiCopyProhibitedClaimMatches(value).length > 0;

export const containsCommercialAiCopyPolicyPhrase = (
  value: string,
  phrase: string,
) => phraseMatches(value, [phrase]).length > 0;

const cleanupSanitizedProductName = (value: string) =>
  value
    .replace(/\(\s*\)/gu, '')
    .replace(/\[\s*\]/gu, '')
    .replace(/\(\s*[,;:|/]\s*/gu, '(')
    .replace(/\s*[,;:|/]\s*\)/gu, ')')
    .replace(/\[\s*[,;:|/]\s*/gu, '[')
    .replace(/\s*[,;:|/]\s*\]/gu, ']')
    .replace(/\s+([,.;:)\]])/gu, '$1')
    .replace(/([([\u002f])\s+/gu, '$1')
    .replace(/\s{2,}/gu, ' ')
    .trim()
    .replace(/^[,.;:|/]+|[,.;:|/]+$/gu, '')
    .trim();

const SANITIZED_CONNECTORS = new Set(['e', 'com', 'de', 'para']);

const sourceWordTokens = (characters: string[]) => {
  const tokens: Array<{
    start: number;
    end: number;
    connector: boolean;
  }> = [];
  let index = 0;
  while (index < characters.length) {
    if (!/[\p{L}\p{N}]/u.test(characters[index])) {
      index += 1;
      continue;
    }
    const start = index;
    while (
      index < characters.length &&
      /[\p{L}\p{N}]/u.test(characters[index])
    ) {
      index += 1;
    }
    const token = normalizeCommercialAiCopyPolicyText(
      characters.slice(start, index).join(''),
    );
    tokens.push({
      start,
      end: index,
      connector: SANITIZED_CONNECTORS.has(token),
    });
  }
  return tokens;
};

const removeDanglingConnectors = (characters: string[], removed: boolean[]) => {
  const tokens = sourceWordTokens(characters);
  let changed = true;
  while (changed) {
    changed = false;
    const visibleTokens = tokens.filter(
      (token) => !removed.slice(token.start, token.end).some(Boolean),
    );

    for (
      let tokenIndex = visibleTokens.length - 1;
      tokenIndex >= 0;
      tokenIndex -= 1
    ) {
      const token = visibleTokens[tokenIndex];
      if (!token.connector) continue;
      const previous = visibleTokens[tokenIndex - 1];
      const next = visibleTokens[tokenIndex + 1];
      const previousSideIsBroken =
        (!previous || previous.connector) &&
        removed.slice(previous?.end ?? 0, token.start).some(Boolean);
      const nextSideIsBroken =
        (!next || next.connector) &&
        removed
          .slice(token.end, next?.start ?? characters.length)
          .some(Boolean);
      if (!previousSideIsBroken && !nextSideIsBroken) continue;
      for (let index = token.start; index < token.end; index += 1) {
        removed[index] = true;
      }
      changed = true;
      break;
    }
  }
};

export const sanitizeCommercialAiCopyProductNameForModel = (value: string) => {
  const source = normalizedSourceText(value);
  const matches = findCommercialAiCopyProhibitedClaimMatches(source);
  const characters = Array.from(source);
  const removed = characters.map(() => false);
  for (const match of [...matches].sort(
    (left, right) => right.start - left.start,
  )) {
    for (let index = match.start; index < match.end; index += 1) {
      removed[index] = true;
    }
  }
  removeDanglingConnectors(characters, removed);
  const sanitized = cleanupSanitizedProductName(
    characters.filter((_character, index) => !removed[index]).join(''),
  );
  if (
    !sanitized ||
    !Array.from(sanitized).some((character) => POLICY_LETTER.test(character))
  ) {
    throw new Error('COMMERCIAL_AI_COPY_MODEL_PRODUCT_NAME_EMPTY');
  }
  return sanitized;
};
