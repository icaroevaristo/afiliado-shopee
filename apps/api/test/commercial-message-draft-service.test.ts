import { describe, it, expect } from 'vitest';
import {
  CommercialMessageDraftService,
  CommercialMessageDraftCandidate,
} from '../src/commercial-message-draft-service';

describe('CommercialMessageDraftService', () => {
  const service = new CommercialMessageDraftService();
  const fixedNow = new Date('2026-08-01T10:00:00.000Z');

  const createValidCandidate = (): CommercialMessageDraftCandidate => ({
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
  });

  it('should generate an IMAGE draft for valid copy and image', () => {
    const candidate = createValidCandidate();
    const draft = service.createDraft(candidate, { now: () => fixedNow });

    expect(draft.candidateId).toBe('candidate-1');
    expect(draft.generatedCopyId).toBe('copy-1');
    expect(draft.imageUrl).toBe('https://shopee.com/image.jpg');
    expect(draft.deliveryMode).toBe('IMAGE');
    expect(draft.warnings).toEqual([]);
    
    const expectedCaption = 'Oferta incrivel!\n\nCompre agora mesmo.\n\nBuy now\nhttps://shope.ee/link\n\n#teste #shopee';
    expect(draft.caption).toBe(expectedCaption);
  });

  it('should generate an IMAGE draft for a valid HTTP image', () => {
    const candidate = createValidCandidate();
    candidate.product.urlImagem = 'http://shopee.com/image.jpg';

    const draft = service.createDraft(candidate, { now: () => fixedNow });

    expect(draft.deliveryMode).toBe('IMAGE');
    expect(draft.imageUrl).toBe('http://shopee.com/image.jpg');
  });
  it('should generate the same IMAGE draft for a reserved candidate', () => {
    const copyReadyDraft = service.createDraft(createValidCandidate(), {
      now: () => fixedNow,
    });
    const reservedCandidate = createValidCandidate();
    reservedCandidate.status = 'RESERVED';

    const reservedDraft = service.createDraft(reservedCandidate, {
      now: () => fixedNow,
    });

    expect(reservedDraft).toEqual(copyReadyDraft);
    expect(reservedDraft.deliveryMode).toBe('IMAGE');
  });

  it('should fallback to TEXT when imageUrl is missing', () => {
    const candidate = createValidCandidate();
    candidate.product.urlImagem = '';
    const draft = service.createDraft(candidate, { now: () => fixedNow });
    
    expect(draft.imageUrl).toBeNull();
    expect(draft.deliveryMode).toBe('TEXT');
    expect(draft.warnings).toContain('COMMERCIAL_MESSAGE_IMAGE_MISSING');
  });

  it('should fallback to TEXT when imageUrl is invalid', () => {
    const candidate = createValidCandidate();
    candidate.product.urlImagem = 'not-a-url';
    const draft = service.createDraft(candidate, { now: () => fixedNow });
    
    expect(draft.imageUrl).toBeNull();
    expect(draft.deliveryMode).toBe('TEXT');
    expect(draft.warnings).toContain('COMMERCIAL_MESSAGE_IMAGE_URL_INVALID');
  });

  it.each([
    'https://shopee.com/im\nage.jpg',
    'https://shopee.com/im\tage.jpg',
    "https://shopee.com/im\u0000age.jpg",
  ])('should fallback to TEXT when imageUrl contains control characters', (urlImagem) => {
    const candidate = createValidCandidate();
    candidate.product.urlImagem = urlImagem;

    const draft = service.createDraft(candidate, { now: () => fixedNow });

    expect(draft).toMatchObject({
      deliveryMode: 'TEXT',
      imageUrl: null,
      warnings: ['COMMERCIAL_MESSAGE_IMAGE_URL_INVALID'],
    });
  });
  it('should fallback to TEXT when imageUrl equals affiliateLink', () => {
    const candidate = createValidCandidate();
    candidate.product.urlImagem = 'https://shope.ee/link';
    const draft = service.createDraft(candidate, { now: () => fixedNow });
    
    expect(draft.imageUrl).toBeNull();
    expect(draft.deliveryMode).toBe('TEXT');
    expect(draft.warnings).toContain('COMMERCIAL_MESSAGE_IMAGE_EQUALS_AFFILIATE_LINK');
  });

  it('should block if relation mismatch (product id)', () => {
    const candidate = createValidCandidate();
    candidate.product.id = 'another';
    expect(() => service.createDraft(candidate, { now: () => fixedNow })).toThrowError('COMMERCIAL_MESSAGE_RELATION_MISMATCH');
  });

  it('should block if relation mismatch (generatedCopy productId)', () => {
    const candidate = createValidCandidate();
    candidate.generatedCopy!.productId = 'another';
    expect(() => service.createDraft(candidate, { now: () => fixedNow })).toThrowError('COMMERCIAL_MESSAGE_RELATION_MISMATCH');
  });

  it('should block if generated copy is missing', () => {
    const candidate = createValidCandidate();
    candidate.generatedCopyId = null;
    candidate.generatedCopy = null;
    expect(() => service.createDraft(candidate, { now: () => fixedNow })).toThrowError('COMMERCIAL_MESSAGE_COPY_MISSING');
  });

  it.each(['QUEUED', 'DISPATCHED', 'EXPIRED', 'BLOCKED'] as const)(
    'should block a %s candidate',
    (status) => {
    const candidate = createValidCandidate();
    candidate.status = status;
    expect(() => service.createDraft(candidate, { now: () => fixedNow })).toThrowError('COMMERCIAL_MESSAGE_CANDIDATE_NOT_READY');
    },
  );

  it('should block if affiliate link is missing', () => {
    const candidate = createValidCandidate();
    candidate.product.affiliateLink = null;
    expect(() => service.createDraft(candidate, { now: () => fixedNow })).toThrowError('COMMERCIAL_MESSAGE_AFFILIATE_LINK_MISSING');
  });

  it('should block if affiliate link does not appear exactly once in caption', () => {
    const candidate = createValidCandidate();
    // Two occurrences
    candidate.generatedCopy!.cta = 'Buy now\nhttps://shope.ee/link\nAnother link: https://shope.ee/link';
    expect(() => service.createDraft(candidate, { now: () => fixedNow })).toThrowError('COMMERCIAL_MESSAGE_INVALID_LINK_OCCURRENCES');
  });

  it('should block if snapshot revision is outdated', () => {
    const candidate = createValidCandidate();
    candidate.snapshot.revision = 2; // Product says 1
    expect(() => service.createDraft(candidate, { now: () => fixedNow })).toThrowError('COMMERCIAL_MESSAGE_SNAPSHOT_OUTDATED');
  });

  it('should block if snapshot shows product unavailable', () => {
    const candidate = createValidCandidate();
    candidate.snapshot.unavailableAt = new Date('2026-07-01T00:00:00Z');
    expect(() => service.createDraft(candidate, { now: () => fixedNow })).toThrowError('COMMERCIAL_MESSAGE_SNAPSHOT_UNAVAILABLE');
  });

  it('should block if product is unavailable', () => {
    const candidate = createValidCandidate();
    candidate.product.unavailableAt = new Date('2026-07-01T00:00:00Z');
    expect(() => service.createDraft(candidate, { now: () => fixedNow })).toThrowError('COMMERCIAL_MESSAGE_PRODUCT_UNAVAILABLE');
  });

  it('should block if offer expired', () => {
    const candidate = createValidCandidate();
    candidate.snapshot.offerEndsAt = new Date('2026-07-01T00:00:00Z');
    expect(() => service.createDraft(candidate, { now: () => fixedNow })).toThrowError('COMMERCIAL_MESSAGE_SNAPSHOT_EXPIRED');
  });

  it('should block if candidate expired', () => {
    const candidate = createValidCandidate();
    candidate.expiresAt = new Date('2026-07-01T00:00:00Z');
    expect(() => service.createDraft(candidate, { now: () => fixedNow })).toThrowError('COMMERCIAL_MESSAGE_CANDIDATE_EXPIRED');
  });

  it('should clean up CRLF and spaces in the caption', () => {
    const candidate = createValidCandidate();
    candidate.generatedCopy!.mensagem = 'Uma mensagem \r\n com espaços extras \n e quebras';
    const draft = service.createDraft(candidate, { now: () => fixedNow });
    expect(draft.caption).toContain('Uma mensagem\n com espaços extras\n e quebras');
  });

  it('cleans a cached apparel size range while preserving the draft commercial blocks', () => {
    const candidate = createValidCandidate();
    candidate.generatedCopy!.titulo = 'SOLA QUE PARECE JET!';
    candidate.generatedCopy!.mensagem =
      'Tênis de Corrida com Placa de Carbono Profissional 33-44\n🔥 POR R$ 71,62\n💸 53% OFF';
    candidate.generatedCopy!.cta = '🛒 Ver oferta:\nhttps://shope.ee/link';
    candidate.generatedCopy!.hashtags =
      '📲 Curtiu o achado? Compartilhe o grupo com alguém que também gosta de economizar.';

    const draft = service.createDraft(candidate, { now: () => fixedNow });

    expect(draft.caption).toContain(
      'Tênis de Corrida com Placa de Carbono Profissional\n🔥 POR R$ 71,62\n💸 53% OFF',
    );
    expect(draft.caption).not.toContain('33-44');
    expect(draft.caption.split('https://shope.ee/link')).toHaveLength(2);
    expect(draft.caption).toContain('🛒 Ver oferta:');
    expect(draft.caption).toContain(
      '📲 Curtiu o achado? Compartilhe o grupo com alguém que também gosta de economizar.',
    );
  });

  it('should omit empty blocks from caption without leaving empty lines', () => {
    const candidate = createValidCandidate();
    candidate.generatedCopy!.hashtags = '   \n  \r\n '; // only spaces and newlines
    const draft = service.createDraft(candidate, { now: () => fixedNow });
    // hashtags should be completely omitted from the caption
    const expectedCaption = 'Oferta incrivel!\n\nCompre agora mesmo.\n\nBuy now\nhttps://shope.ee/link';
    expect(draft.caption).toBe(expectedCaption);
  });
});
