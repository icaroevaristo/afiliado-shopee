import { AppError } from '@shopee-auto-affiliate-ai/shared';

import type { CommercialAiCopyOutput } from './commercial-ai-copy-provider';
import { COMMERCIAL_AI_COPY_BODY_MAX_LENGTH } from './commercial-ai-copy-policy';
import type { CommercialPromotionSignal } from './repositories';

export type AssembledCommercialPromotionCopy = {
  titulo: string;
  mensagem: string;
  cta: string;
  hashtags: string;
};

export type CommercialPromotionCopyAssemblerInput = {
  output: CommercialAiCopyOutput;
  productName: string;
  shopName: string;
  price: string;
  discountRate: number;
  promotionSignals: CommercialPromotionSignal[];
  priceDropPercent: string | null;
  affiliateLink: string;
  /** Trusted destination fact. Invalid or missing values omit the group footer. */
  groupInviteUrl?: string | null;
  maximumLength: number;
};

export type CommercialPromotionCopyTrustedFacts = Pick<
  CommercialPromotionCopyAssemblerInput,
  | 'productName'
  | 'shopName'
  | 'price'
  | 'discountRate'
  | 'promotionSignals'
  | 'priceDropPercent'
  | 'groupInviteUrl'
>;

const formatCurrency = (value: string) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new AppError(
      'Preco comercial invalido',
      'COMMERCIAL_AI_COPY_FACTS_INVALID',
    );
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
    .format(amount)
    .replace(/\u00a0/gu, ' ');
};

const formatPercent = (value: string | number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AppError(
      'Percentual comercial invalido',
      'COMMERCIAL_AI_COPY_FACTS_INVALID',
    );
  }
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(
    parsed,
  );
};

const extraSignalLine = (input: CommercialPromotionCopyTrustedFacts) => {
  if (input.promotionSignals.includes('PRICE_DROP')) {
    if (input.priceDropPercent === null) {
      throw new AppError(
        'Queda de preco sem percentual',
        'COMMERCIAL_AI_COPY_FACTS_INVALID',
      );
    }
    return `📉 Queda de ${formatPercent(input.priceDropPercent)}% observada desde a medição anterior.`;
  }
  if (input.promotionSignals.includes('DISCOUNT_INCREASE')) {
    return '📈 O desconto informado aumentou desde a medição anterior.';
  }
  if (input.promotionSignals.includes('NEWLY_OBSERVED')) {
    return '🆕 Oferta recém-observada pelo nosso sistema.';
  }
  return null;
};

const ANY_URL_SOURCE = String.raw`(?:[a-z][a-z0-9+.-]*://|www\.)\S+|\b(?:[\p{L}0-9-]+\.)+[\p{L}]{2,63}(?:/\S*)?`;
const ADDITIONAL_URL = new RegExp(ANY_URL_SOURCE, 'iu');
const ANY_URL = new RegExp(ANY_URL_SOURCE, 'giu');
const TRUSTED_FACT_URL_SOURCE = String.raw`(?:[a-z][a-z0-9+.-]*://|www\.)\S+|\b(?:[\p{L}0-9-]+\.)+[\p{L}]{2,63}(?::\d{1,5})?(?:[/?#])\S*`;
const TRUSTED_FACT_URL = new RegExp(TRUSTED_FACT_URL_SOURCE, 'iu');
const ASCII_CONTROL_OR_DEL = /[\u0000-\u001F\u007F]/u;
const COMMERCIAL_COPY_CTA_PREFIX = '🛒 Compre aqui:';
const COMMERCIAL_COPY_GROUP_FOOTER_PREFIX =
  '📎 Encaminhe para um amigo participar do grupo:';
const FOOTWEAR_OR_APPAREL_CONTEXT =
  /\b(?:t[eê]nis|cal[cç]ado|sapato(?:s)?|bota(?:s)?|sand[aá]lia(?:s)?|chinelo(?:s)?|vestu[aá]rio|roupa(?:s)?|camiseta(?:s)?|camisa(?:s)?|cal[cç]a(?:s)?|bermuda(?:s)?|saia(?:s)?|vestido(?:s)?|blusa(?:s)?|jaqueta(?:s)?|moletom|short(?:s)?|meia(?:s)?|tamanho(?:s)?)\b/iu;
const PURCHASE_SIZE_RANGE = /(?:\s*\(\s*)?\b\d{2}\s*-\s*\d{2}\b(?:\s*\))?/gu;
const GROUP_INVITE_PATH = /^\/[A-Za-z0-9_-]+$/u;

export const hasAsciiControlOrDel = (value: string) =>
  ASCII_CONTROL_OR_DEL.test(value);

export const cleanCommercialPromotionBody = (body: string) => {
  if (!FOOTWEAR_OR_APPAREL_CONTEXT.test(body)) return body;

  return body
    .replace(PURCHASE_SIZE_RANGE, '')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/[ \t]+([,.;:!?])/gu, '$1')
    .replace(/[ \t]+\n/gu, '\n')
    .trim();
};

export const validateTrustedGroupInviteUrl = (
  value: string | null | undefined,
) => {
  if (!value || hasAsciiControlOrDel(value)) return null;
  if (!/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+$/u.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'chat.whatsapp.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !GROUP_INVITE_PATH.test(url.pathname)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
};

const publicMessage = (copy: AssembledCommercialPromotionCopy) =>
  [copy.titulo, copy.mensagem, copy.cta, copy.hashtags]
    .filter(Boolean)
    .join('\n\n');

const trustedFactsContainNavigableUrl = (
  facts: Pick<CommercialPromotionCopyTrustedFacts, 'productName' | 'shopName'>,
) =>
  TRUSTED_FACT_URL.test(facts.productName) ||
  TRUSTED_FACT_URL.test(facts.shopName);

const trustedOfferBlock = (facts: CommercialPromotionCopyTrustedFacts) => {
  extraSignalLine(facts);
  return [
    `🔥 POR: ${formatCurrency(facts.price)}`,
    ...(facts.discountRate > 0
      ? [`💸 ${formatPercent(facts.discountRate)}% OFF`]
      : []),
  ].join('\n');
};

const trustedGroupFooter = (facts: CommercialPromotionCopyTrustedFacts) => {
  const inviteUrl = validateTrustedGroupInviteUrl(facts.groupInviteUrl);
  return inviteUrl ? `${COMMERCIAL_COPY_GROUP_FOOTER_PREFIX} ${inviteUrl}` : '';
};

const aiOutputMessage = (output: CommercialAiCopyOutput) =>
  [output.headline, output.body].filter(Boolean).join('\n\n');

const CACHED_OFFER_SUFFIX =
  /\n🔥 POR: R\$ [0-9.]+,[0-9]{2}(?:\n💸 [0-9.,]+% OFF)?$/u;
const CACHED_CTA = /^🛒 Compre aqui: (https?:\/\/\S+)$/u;
const CACHED_MESSAGE_UNSAFE_CONTROL = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/u;

export const extractCachedCommercialAiCopyOutput = (
  copy: Pick<
    AssembledCommercialPromotionCopy,
    'titulo' | 'mensagem' | 'cta' | 'hashtags'
  >,
): CommercialAiCopyOutput | null => {
  if (
    !copy.titulo ||
    hasAsciiControlOrDel(copy.titulo) ||
    CACHED_MESSAGE_UNSAFE_CONTROL.test(copy.mensagem) ||
    hasAsciiControlOrDel(copy.cta) ||
    hasAsciiControlOrDel(copy.hashtags)
  ) {
    return null;
  }
  const offerMatch = copy.mensagem.match(CACHED_OFFER_SUFFIX);
  const ctaMatch = copy.cta.match(CACHED_CTA);
  if (!offerMatch || !ctaMatch) return null;
  if (!validateTrustedGroupInviteUrlFromCachedCopy(copy.hashtags)) return null;
  const body = copy.mensagem.slice(0, -offerMatch[0].length).trim();
  if (!body || body.length > COMMERCIAL_AI_COPY_BODY_MAX_LENGTH) return null;
  return { headline: copy.titulo, body };
};

const validateTrustedGroupInviteUrlFromCachedCopy = (value: string) => {
  if (!value) return true;
  if (!value.startsWith(`${COMMERCIAL_COPY_GROUP_FOOTER_PREFIX} `)) {
    return false;
  }
  return (
    validateTrustedGroupInviteUrl(
      value.slice(COMMERCIAL_COPY_GROUP_FOOTER_PREFIX.length + 1),
    ) !== null
  );
};

const cachedAiOutputMessage = (
  copy: AssembledCommercialPromotionCopy,
  affiliateLink: string,
  trustedFacts: CommercialPromotionCopyTrustedFacts,
) => {
  const offerSuffix = `\n${trustedOfferBlock(trustedFacts)}`;
  const expectedCta = `${COMMERCIAL_COPY_CTA_PREFIX} ${affiliateLink}`;
  if (
    !copy.mensagem.endsWith(offerSuffix) ||
    copy.cta !== expectedCta ||
    copy.hashtags !== trustedGroupFooter(trustedFacts)
  ) {
    return null;
  }
  const body = copy.mensagem.slice(0, -offerSuffix.length);
  if (body.length > COMMERCIAL_AI_COPY_BODY_MAX_LENGTH) return null;
  return publicMessage({
    titulo: copy.titulo,
    mensagem: body,
    cta: '',
    hashtags: '',
  });
};

export const isSafeAssembledCommercialPromotionCopy = (
  copy: AssembledCommercialPromotionCopy,
  affiliateLink: string,
  trustedFacts: CommercialPromotionCopyTrustedFacts,
  maximumLength: number,
) => {
  if (hasAsciiControlOrDel(affiliateLink)) return false;
  try {
    const url = new URL(affiliateLink);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
  } catch {
    return false;
  }
  const message = publicMessage(copy);
  const linkOccurrences = message.split(affiliateLink).length - 1;
  const trustedInviteUrl = validateTrustedGroupInviteUrl(
    trustedFacts.groupInviteUrl,
  );
  const inviteOccurrences = trustedInviteUrl
    ? message.split(trustedInviteUrl).length - 1
    : 0;
  if (trustedFactsContainNavigableUrl(trustedFacts)) return false;
  let aiMessage: string | null;
  try {
    aiMessage = cachedAiOutputMessage(copy, affiliateLink, trustedFacts);
  } catch {
    return false;
  }
  return (
    message.length <= maximumLength &&
    linkOccurrences === 1 &&
    inviteOccurrences === (trustedInviteUrl ? 1 : 0) &&
    aiMessage !== null &&
    !ADDITIONAL_URL.test(aiMessage)
  );
};

export class CommercialPromotionCopyAssembler {
  assemble(
    input: CommercialPromotionCopyAssemblerInput,
  ): AssembledCommercialPromotionCopy {
    if (hasAsciiControlOrDel(input.affiliateLink)) {
      throw new AppError(
        'Link afiliado invalido',
        'COMMERCIAL_AI_COPY_AFFILIATE_LINK_REQUIRED',
      );
    }
    let url: URL;
    try {
      url = new URL(input.affiliateLink);
    } catch {
      throw new AppError(
        'Link afiliado invalido',
        'COMMERCIAL_AI_COPY_AFFILIATE_LINK_REQUIRED',
      );
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new AppError(
        'Link afiliado invalido',
        'COMMERCIAL_AI_COPY_AFFILIATE_LINK_REQUIRED',
      );
    }
    if (
      trustedFactsContainNavigableUrl(input) ||
      ADDITIONAL_URL.test(aiOutputMessage(input.output))
    ) {
      throw new AppError(
        'Copy contem URL adicional',
        'COMMERCIAL_AI_COPY_URL_INVALID',
      );
    }
    const lines = [
      cleanCommercialPromotionBody(input.output.body),
      trustedOfferBlock(input),
    ];
    const body = lines[0];
    if (body.length > COMMERCIAL_AI_COPY_BODY_MAX_LENGTH) {
      throw new AppError(
        'Identidade do produto excede o limite',
        'COMMERCIAL_AI_COPY_BODY_TOO_LONG',
      );
    }
    const copy = {
      titulo: input.output.headline,
      mensagem: lines.join('\n'),
      cta: `${COMMERCIAL_COPY_CTA_PREFIX} ${input.affiliateLink}`,
      hashtags: trustedGroupFooter(input),
    };
    const finalMessage = publicMessage(copy);
    const linkOccurrences = finalMessage.split(input.affiliateLink).length - 1;
    const trustedInviteUrl = validateTrustedGroupInviteUrl(input.groupInviteUrl);
    const inviteOccurrences = trustedInviteUrl
      ? finalMessage.split(trustedInviteUrl).length - 1
      : 0;
    if (
      linkOccurrences !== 1 ||
      inviteOccurrences !== (trustedInviteUrl ? 1 : 0)
    ) {
      throw new AppError(
        'Copy contem URL adicional',
        'COMMERCIAL_AI_COPY_URL_INVALID',
      );
    }
    if (finalMessage.length > input.maximumLength) {
      throw new AppError('Copy excede o limite', 'COMMERCIAL_AI_COPY_TOO_LONG');
    }
    return copy;
  }
}

export const sanitizeCommercialPromotionCopy = (
  copy: AssembledCommercialPromotionCopy,
  affiliateLink: string,
) => {
  const sanitize = (value: string) =>
    value
      .replaceAll(affiliateLink, '[LINK_AFILIADO]')
      .replace(ANY_URL, '[LINK_REMOVIDO]');
  return {
    titulo: sanitize(copy.titulo),
    mensagem: cleanCommercialPromotionBody(sanitize(copy.mensagem)),
    cta: sanitize(copy.cta),
    hashtags: sanitize(copy.hashtags),
  };
};
