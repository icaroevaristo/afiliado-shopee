import { describe, expect, it } from 'vitest';
import { render } from '../test/render';
import { SafeProductImage } from './safe-product-image';

describe('SafeProductImage', () => {
  it('nao inicia request para imagem externa durante o uso local', async () => {
    const screen = await render(
      <SafeProductImage src="https://cf.shopee.com.br/product.jpg" />,
    );

    expect(screen.container.querySelector('img')).toBeNull();
    expect(
      screen.container.querySelector(
        '[aria-label="Imagem externa indisponivel no modo local"]',
      ),
    ).not.toBeNull();
    await screen.unmount();
  });

  it('mantem imagens same-origin disponiveis', async () => {
    const screen = await render(
      <SafeProductImage src="/product.jpg" alt="Produto" />,
    );

    const image = screen.container.querySelector('img');
    expect(image?.getAttribute('alt')).toBe('Produto');
    expect(image?.getAttribute('src')).toBe('/product.jpg');
    await screen.unmount();
  });
});
