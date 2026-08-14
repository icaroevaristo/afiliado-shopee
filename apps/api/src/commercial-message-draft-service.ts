import { cleanCommercialPromotionBody } from './commercial-promotion-copy-assembler';

export type CommercialMessageDraftCandidate = {
  id: string;
  productId: string;
  snapshotId: string;
  generatedCopyId: string | null;
  status: string;
  expiresAt: Date | null;
  product: {
    id: string;
    unavailableAt: Date | null;
    affiliateLink: string | null;
    urlImagem: string;
    commercialSnapshotRevision: number;
  };
  snapshot: {
    id: string;
    productId: string;
    revision: number;
    unavailableAt: Date | null;
    offerEndsAt: Date | null;
  };
  generatedCopy: {
    id: string;
    productId: string;
    snapshotId: string | null;
    createdFromCandidateId: string | null;
    titulo: string;
    mensagem: string;
    cta: string;
    hashtags: string;
  } | null;
};

export type CommercialMessageDraft = {
  candidateId: string;
  generatedCopyId: string;
  imageUrl: string | null;
  caption: string;
  deliveryMode: 'IMAGE' | 'TEXT';
  warnings: string[];
};

export const COMMERCIAL_AUTOMATION_IMAGE_REQUIRED =
  'COMMERCIAL_AUTOMATION_IMAGE_REQUIRED';

export class CommercialMessageDraftService {
  createDraft(
    candidate: CommercialMessageDraftCandidate,
    deps: { now?: () => Date } = {},
  ): CommercialMessageDraft {
    const now = (deps.now ?? (() => new Date()))();

    if (candidate.status !== 'COPY_READY' && candidate.status !== 'RESERVED') {
      throw new Error('COMMERCIAL_MESSAGE_CANDIDATE_NOT_READY');
    }
    if (!candidate.generatedCopyId || !candidate.generatedCopy) {
      throw new Error('COMMERCIAL_MESSAGE_COPY_MISSING');
    }

    const product = candidate.product;
    const snapshot = candidate.snapshot;
    const copy = candidate.generatedCopy;

    if (
      candidate.productId !== product.id ||
      candidate.snapshotId !== snapshot.id ||
      candidate.generatedCopyId !== copy.id ||
      snapshot.productId !== product.id ||
      copy.productId !== product.id ||
      copy.snapshotId !== snapshot.id ||
      copy.createdFromCandidateId !== candidate.id
    ) {
      throw new Error('COMMERCIAL_MESSAGE_RELATION_MISMATCH');
    }

    if (product.unavailableAt) {
      throw new Error('COMMERCIAL_MESSAGE_PRODUCT_UNAVAILABLE');
    }
    if (!product.affiliateLink) {
      throw new Error('COMMERCIAL_MESSAGE_AFFILIATE_LINK_MISSING');
    }
    if (snapshot.revision !== product.commercialSnapshotRevision) {
      throw new Error('COMMERCIAL_MESSAGE_SNAPSHOT_OUTDATED');
    }
    if (snapshot.unavailableAt) {
      throw new Error('COMMERCIAL_MESSAGE_SNAPSHOT_UNAVAILABLE');
    }
    if (snapshot.offerEndsAt && snapshot.offerEndsAt < now) {
      throw new Error('COMMERCIAL_MESSAGE_SNAPSHOT_EXPIRED');
    }
    if (candidate.expiresAt && candidate.expiresAt < now) {
      throw new Error('COMMERCIAL_MESSAGE_CANDIDATE_EXPIRED');
    }

    const affiliateLink = product.affiliateLink.trim();

    const parts = [
      copy.titulo,
      cleanCommercialPromotionBody(copy.mensagem),
      copy.cta,
      copy.hashtags,
    ]
      .map((s) => s.trim())
      .filter(Boolean);

    let caption = parts.join('\n\n');
    caption = caption.replace(/\r\n/g, '\n').replace(/ +\n/g, '\n').trim();

    const linkOccurrences = caption.split(affiliateLink).length - 1;
    if (linkOccurrences !== 1) {
      throw new Error('COMMERCIAL_MESSAGE_INVALID_LINK_OCCURRENCES');
    }

    let imageUrl: string | null = product.urlImagem?.trim() || null;
    let deliveryMode: 'IMAGE' | 'TEXT' = 'IMAGE';
    const warnings: string[] = [];

    if (!imageUrl) {
      deliveryMode = 'TEXT';
      imageUrl = null;
      warnings.push('COMMERCIAL_MESSAGE_IMAGE_MISSING');
    } else {
      try {
        const url = new URL(imageUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          deliveryMode = 'TEXT';
          imageUrl = null;
          warnings.push('COMMERCIAL_MESSAGE_IMAGE_URL_INVALID');
        } else if (imageUrl === affiliateLink) {
          deliveryMode = 'TEXT';
          imageUrl = null;
          warnings.push('COMMERCIAL_MESSAGE_IMAGE_EQUALS_AFFILIATE_LINK');
        }
      } catch {
        deliveryMode = 'TEXT';
        imageUrl = null;
        warnings.push('COMMERCIAL_MESSAGE_IMAGE_URL_INVALID');
      }
    }

    return {
      candidateId: candidate.id,
      generatedCopyId: copy.id,
      imageUrl,
      caption,
      deliveryMode,
      warnings,
    };
  }
}
