import { describe, expect, it } from 'vitest';
import {
  assertCompatibleShopeeProductIdentity,
  assertCompleteShopeeProductIdentity,
  PRODUCT_VARIANT_DEDUPLICATION,
  resolveShopeeProductIdentity,
  SHOPEE_PRODUCT_IDENTITY_INCOMPLETE,
} from '../src/shopee-product-identity';

describe('Shopee product identity', () => {
  it('usa source + providerProductId como identidade atomica e nao inventa variante', () => {
    expect(
      resolveShopeeProductIdentity({
        source: 'OFFICIAL',
        providerProductId: '123',
        shopId: 'shop-1',
      }),
    ).toEqual({
      key: 'OFFICIAL:123',
      source: 'OFFICIAL',
      providerProductId: '123',
      shopId: 'shop-1',
      variantIdentity: 'UNAVAILABLE',
    });
  });

  it('exige shopId em nova observacao OFFICIAL', () => {
    expect(() =>
      assertCompleteShopeeProductIdentity({
        source: 'OFFICIAL',
        providerProductId: '123',
      }),
    ).toThrowError(expect.objectContaining({ code: SHOPEE_PRODUCT_IDENTITY_INCOMPLETE }));
  });

  it('preserva registro legado sem shopId para leitura', () => {
    expect(
      resolveShopeeProductIdentity({ source: 'OFFICIAL', providerProductId: '123' }),
    ).toMatchObject({ key: 'OFFICIAL:123', shopId: null });
  });

  it('falha fechado quando o mesmo itemId aparece em lojas diferentes', () => {
    expect(() =>
      assertCompatibleShopeeProductIdentity(
        { source: 'OFFICIAL', providerProductId: '123', shopId: 'shop-1' },
        { source: 'OFFICIAL', providerProductId: '123', shopId: 'shop-2' },
      ),
    ).toThrowError(expect.objectContaining({ code: PRODUCT_VARIANT_DEDUPLICATION }));
  });

  it('nao mescla providerProductIds distintos mesmo na mesma loja', () => {
    const left = resolveShopeeProductIdentity({
      source: 'OFFICIAL', providerProductId: '123', shopId: 'shop-1',
    });
    const right = resolveShopeeProductIdentity({
      source: 'OFFICIAL', providerProductId: '456', shopId: 'shop-1',
    });
    expect(left.key).not.toBe(right.key);
    expect(() =>
      assertCompatibleShopeeProductIdentity(
        { source: 'OFFICIAL', providerProductId: '123', shopId: 'shop-1' },
        { source: 'OFFICIAL', providerProductId: '456', shopId: 'shop-1' },
      ),
    ).not.toThrow();
  });
});
