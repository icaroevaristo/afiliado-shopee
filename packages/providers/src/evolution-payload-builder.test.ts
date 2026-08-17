import { describe, it, expect } from 'vitest';
import { buildEvolutionMessagePayload } from '../src/evolution-payload-builder';

describe('EvolutionPayloadBuilder', () => {
  it('should build a text payload when deliveryMode is TEXT', () => {
    const payload = buildEvolutionMessagePayload({
      baseUrl: 'https://api.example.com',
      instanceName: 'test-instance',
      destination: '5511999999999',
      deliveryMode: 'TEXT',
      text: 'Hello World',
    });

    expect(payload.url).toBe('https://api.example.com/message/sendText/test-instance');
    expect(payload.method).toBe('POST');
    const body = JSON.parse(payload.body);
    expect(body.number).toBe('5511999999999');
    expect(body.text).toBe('Hello World');
    expect(body.media).toBeUndefined();
  });

  it('should build a media payload when deliveryMode is IMAGE and imageUrl is present', () => {
    const payload = buildEvolutionMessagePayload({
      baseUrl: 'https://api.example.com',
      instanceName: 'test-instance',
      destination: '5511999999999',
      deliveryMode: 'IMAGE',
      caption: 'Look at this!',
      imageUrl: 'https://example.com/image.jpg',
    });

    expect(payload.url).toBe('https://api.example.com/message/sendMedia/test-instance');
    expect(payload.method).toBe('POST');
    const body = JSON.parse(payload.body);
    expect(body.number).toBe('5511999999999');
    expect(body.mediatype).toBe('image');
    expect(body.media).toBe('https://example.com/image.jpg');
    expect(body.caption).toBe('Look at this!');
  });

  it('should fallback to caption if text is not provided in TEXT mode', () => {
    const payload = buildEvolutionMessagePayload({
      baseUrl: 'https://api.example.com',
      instanceName: 'test-instance',
      destination: '5511999999999',
      deliveryMode: 'TEXT',
      caption: 'Hello Caption',
    });

    const body = JSON.parse(payload.body);
    expect(body.text).toBe('Hello Caption');
  });

  it('should fallback to text if caption is not provided in IMAGE mode', () => {
    const payload = buildEvolutionMessagePayload({
      baseUrl: 'https://api.example.com',
      instanceName: 'test-instance',
      destination: '5511999999999',
      deliveryMode: 'IMAGE',
      text: 'Hello Text',
      imageUrl: 'https://example.com/image.jpg',
    });

    const body = JSON.parse(payload.body);
    expect(body.caption).toBe('Hello Text');
  });

  it('should reject invalid baseUrl', () => {
    expect(() => buildEvolutionMessagePayload({
      baseUrl: 'not-a-url',
      instanceName: 'test-instance',
      destination: '5511999999999',
      deliveryMode: 'TEXT',
      text: 'Hello',
    })).toThrowError('COMMERCIAL_EVOLUTION_INVALID_BASE_URL');
  });

  it('should reject invalid instanceName', () => {
    expect(() => buildEvolutionMessagePayload({
      baseUrl: 'https://api.example.com',
      instanceName: '  ',
      destination: '5511999999999',
      deliveryMode: 'TEXT',
      text: 'Hello',
    })).toThrowError('COMMERCIAL_EVOLUTION_INVALID_INSTANCE_NAME');
  });

  it('should reject invalid destination', () => {
    expect(() => buildEvolutionMessagePayload({
      baseUrl: 'https://api.example.com',
      instanceName: 'test-instance',
      destination: '',
      deliveryMode: 'TEXT',
      text: 'Hello',
    })).toThrowError('COMMERCIAL_EVOLUTION_INVALID_DESTINATION');
  });

  it('should reject empty content', () => {
    expect(() => buildEvolutionMessagePayload({
      baseUrl: 'https://api.example.com',
      instanceName: 'test-instance',
      destination: '5511999999999',
      deliveryMode: 'TEXT',
      text: '   ',
    })).toThrowError('COMMERCIAL_EVOLUTION_INVALID_CONTENT');
  });

  it('should reject invalid imageUrl in IMAGE mode', () => {
    expect(() => buildEvolutionMessagePayload({
      baseUrl: 'https://api.example.com',
      instanceName: 'test-instance',
      destination: '5511999999999',
      deliveryMode: 'IMAGE',
      text: 'Hello',
      imageUrl: 'not-a-url',
    })).toThrowError('COMMERCIAL_EVOLUTION_INVALID_IMAGE_URL');
  });

  it.each([
    'https://example.com/im\nage.jpg',
    'https://example.com/im\tage.jpg',
    "https://example.com/im\u0000age.jpg",
  ])('should reject control characters in IMAGE imageUrl', (imageUrl) => {
    expect(() =>
      buildEvolutionMessagePayload({
        baseUrl: 'https://api.example.com',
        instanceName: 'test-instance',
        destination: '5511999999999',
        deliveryMode: 'IMAGE',
        text: 'Hello',
        imageUrl,
      }),
    ).toThrowError('COMMERCIAL_EVOLUTION_INVALID_IMAGE_URL');
  });
  it('should reject missing imageUrl in IMAGE mode', () => {
    expect(() => buildEvolutionMessagePayload({
      baseUrl: 'https://api.example.com',
      instanceName: 'test-instance',
      destination: '5511999999999',
      deliveryMode: 'IMAGE',
      text: 'Hello',
    })).toThrowError('COMMERCIAL_EVOLUTION_INVALID_IMAGE_URL');
  });
});
