import React, { act } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '../test/render';
import { isSafeImageUrl, SafeProductImage } from './safe-product-image';

describe('isSafeImageUrl', () => {
  it('permite URL relativa', () => {
    expect(isSafeImageUrl('/products/image.jpg', 'http://dashboard.local')).toBe(
      true,
    );
  });

  it('permite URL same-origin', () => {
    expect(
      isSafeImageUrl(
        'http://dashboard.local/products/image.jpg',
        'http://dashboard.local',
      ),
    ).toBe(true);
  });

  it('permite URL HTTPS externa', () => {
    expect(isSafeImageUrl('https://cdn.example.com/product.jpg')).toBe(true);
  });

  it.each(['javascript:alert(1)', 'data:image/png;base64,abc'])
    ('rejeita protocolo inseguro: %s', (source) => {
      expect(isSafeImageUrl(source)).toBe(false);
    });

  it('rejeita URL malformada', () => {
    expect(isSafeImageUrl('https://')).toBe(false);
  });
});

describe('SafeProductImage', () => {
  it('renderiza imagem HTTPS externa com atributos seguros', async () => {
    const screen = await render(
      <SafeProductImage src="https://cdn.example.com/product.jpg" alt="Produto" />,
    );

    const image = screen.container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://cdn.example.com/product.jpg');
    expect(image?.getAttribute('loading')).toBe('lazy');
    expect(image?.getAttribute('decoding')).toBe('async');
    expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer');
    await screen.unmount();
  });

  it('mostra fallback quando a imagem falha', async () => {
    const screen = await render(
      <SafeProductImage src="https://cdn.example.com/missing.jpg" />,
    );
    const image = screen.container.querySelector('img');

    await act(async () => {
      image?.dispatchEvent(new Event('error'));
    });

    expect(screen.container.querySelector('img')).toBeNull();
    expect(
      screen.container.querySelector(
        '[aria-label="Imagem do produto indisponivel"]',
      ),
    ).not.toBeNull();
    await screen.unmount();
  });
});
