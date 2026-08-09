import type { Product, ProductFilters } from '@shopee-auto-affiliate-ai/shared';
import { WhatsAppSendError } from './whatsapp-send-error';

export * from './shopee-affiliate-offers';
export * from './manual-shopee-affiliate-offer-provider';
export * from './mock-shopee-affiliate-offer-provider';
export * from './official-shopee-affiliate-offer-provider';
export { parseEvolutionConnectionState } from './evolution-connection-state';
export { WhatsAppSendError } from './whatsapp-send-error';

export {
  EvolutionApiWhatsAppProvider,
  type EvolutionApiWhatsAppProviderOptions,
  type HttpClient,
  type ProviderLogger,
} from './evolution-api-whatsapp-provider';
export {
  EvolutionApiGroupDirectoryProvider,
  type EvolutionApiGroupDirectoryProviderOptions,
} from './evolution-api-group-directory-provider';
export {
  EvolutionGroupSendGuard,
  type EvolutionGroupSendGuardOptions,
} from './evolution-group-send-guard';
export {
  fingerprintWhatsAppGroupId,
  isWhatsAppGroupId,
  normalizeWhatsAppGroupId,
  type WhatsAppGroupDirectoryProvider,
  type WhatsAppGroupSummary,
} from './whatsapp-group-directory';
export {
  EvolutionSendGuard,
  maskEvolutionDestination,
  normalizeEvolutionDestination,
  type EvolutionSendGuardOptions,
} from './evolution-send-guard';
export {
  createWhatsAppProvider,
  type WhatsAppProviderFactoryConfig,
  type WhatsAppProviderFactoryOptions,
} from './whatsapp-provider-factory';

export interface HunterProvider {
  buscarProdutos(filters?: ProductFilters): Promise<Product[]>;
}

export interface ShopeeProvider extends HunterProvider {
  searchProducts(query: string): Promise<Product[]>;
}

export interface OpenAIProvider {
  generateCopy(input: { product: Product; tone?: string }): Promise<string>;
}

export interface EvolutionProvider {
  sendMessage(input: { to: string; message: string }): Promise<{ id: string }>;
}

export type WhatsAppSendInput = {
  destination: string;
  message: string;
  destinationType?: 'INDIVIDUAL' | 'GROUP';
  imageUrl?: string | null;
};

export type WhatsAppSendResult = {
  externalMessageId: string;
  status: 'sent';
  sentAt: Date;
};

export interface WhatsAppProvider {
  beginRun?(runId: string): void;
  sendMessage(input: WhatsAppSendInput): Promise<WhatsAppSendResult>;
}

export class MockWhatsAppProvider implements WhatsAppProvider {
  private readonly calls: WhatsAppSendInput[] = [];
  private shouldFail = false;
  private failureMessage = 'Mock WhatsApp provider failure';
  private sequence = 1;

  get sentMessages() {
    return [...this.calls];
  }

  simulateFailure(message = 'Mock WhatsApp provider failure') {
    this.shouldFail = true;
    this.failureMessage = message;
  }

  clearFailure() {
    this.shouldFail = false;
  }

  reset() {
    this.calls.length = 0;
    this.sequence = 1;
    this.clearFailure();
  }

  async sendMessage(input: WhatsAppSendInput): Promise<WhatsAppSendResult> {
    if (input.destination.trim().length === 0) {
      throw new WhatsAppSendError(
        'Destino WhatsApp é obrigatório',
        'WHATSAPP_DESTINATION_REQUIRED',
        { deliveryMayHaveStarted: false },
      );
    }
    if (input.message.trim().length === 0) {
      throw new WhatsAppSendError(
        'Mensagem WhatsApp é obrigatória',
        'WHATSAPP_MESSAGE_REQUIRED',
        { deliveryMayHaveStarted: false },
      );
    }
    const rawImageUrl = input.imageUrl;
    const imageRequested = rawImageUrl !== undefined && rawImageUrl !== null;
    let imageUrl: string | undefined;

    if (imageRequested) {
      const trimmed = typeof rawImageUrl === 'string' ? rawImageUrl.trim() : '';
      if (trimmed.length === 0) {
        throw new WhatsAppSendError(
          'URL de imagem invalida',
          'WHATSAPP_IMAGE_URL_INVALID',
          { deliveryMayHaveStarted: false },
        );
      }
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(trimmed);
      } catch {
        throw new WhatsAppSendError(
          'URL de imagem invalida',
          'WHATSAPP_IMAGE_URL_INVALID',
          { deliveryMayHaveStarted: false },
        );
      }
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new WhatsAppSendError(
          'URL de imagem invalida',
          'WHATSAPP_IMAGE_URL_INVALID',
          { deliveryMayHaveStarted: false },
        );
      }
      imageUrl = trimmed;
    }

    if (this.shouldFail) {
      throw new WhatsAppSendError(
        this.failureMessage,
        'MOCK_WHATSAPP_FAILURE',
        { deliveryMayHaveStarted: false },
      );
    }

    const recordedInput: WhatsAppSendInput = {
      ...input,
      ...(imageRequested ? { imageUrl } : {}),
    };
    this.calls.push(recordedInput);
    return {
      externalMessageId: `mock-whatsapp-${this.sequence++}`,
      status: 'sent',
      sentAt: new Date(),
    };
  }
}

const categorias = [
  'Eletrônicos',
  'Casa',
  'Beleza',
  'Moda',
  'Esportes',
  'Pets',
  'Bebês',
  'Automotivo',
];

const produtosBase = Array.from({ length: 40 }, (_, index) => {
  const numero = index + 1;
  const categoria = categorias[index % categorias.length];
  return {
    id: `mock-shopee-${numero.toString().padStart(2, '0')}`,
    nome: `${categoria} Produto Afiliado ${numero}`,
    categoria,
    preco: Number((29.9 + index * 7.35).toFixed(2)),
    desconto: 5 + (index % 9) * 5,
    nota: Number((4.1 + (index % 9) * 0.1).toFixed(1)),
    vendidos: 80 + index * 37,
    comissao: Number((0.04 + (index % 7) * 0.015).toFixed(3)),
    loja: `Loja Parceira ${(index % 10) + 1}`,
    urlImagem: `https://example.com/images/mock-shopee-${numero}.jpg`,
    url: `https://example.com/produto/mock-shopee-${numero}`,
  } satisfies Product;
});

const produtoAtendeFiltros = (produto: Product, filters?: ProductFilters) => {
  if (!filters) return true;
  return (
    (!filters.categoria || produto.categoria === filters.categoria) &&
    (filters.precoMin === undefined || produto.preco >= filters.precoMin) &&
    (filters.precoMax === undefined || produto.preco <= filters.precoMax) &&
    (filters.descontoMin === undefined ||
      produto.desconto >= filters.descontoMin) &&
    (filters.notaMin === undefined || produto.nota >= filters.notaMin) &&
    (filters.vendidosMin === undefined ||
      produto.vendidos >= filters.vendidosMin) &&
    (filters.comissaoMin === undefined ||
      produto.comissao >= filters.comissaoMin)
  );
};

export class MockShopeeProvider implements ShopeeProvider {
  async buscarProdutos(filters?: ProductFilters) {
    return produtosBase.filter((produto) =>
      produtoAtendeFiltros(produto, filters),
    );
  }

  async searchProducts(query: string) {
    const normalizado = query.trim().toLocaleLowerCase('pt-BR');
    const produtos = await this.buscarProdutos();
    return normalizado
      ? produtos.filter((produto) =>
          produto.nome.toLocaleLowerCase('pt-BR').includes(normalizado),
        )
      : produtos;
  }
}

export class MockOpenAIProvider implements OpenAIProvider {
  async generateCopy({ product }: { product: Product }) {
    return `Oferta encontrada: ${product.nome}`;
  }
}

export class MockEvolutionProvider implements EvolutionProvider {
  async sendMessage() {
    return { id: 'mock-message' };
  }
}
export * from './evolution-payload-builder';
