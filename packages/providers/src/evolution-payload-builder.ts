export type EvolutionPayloadOptions = {
  baseUrl: string;
  instanceName: string;
  destination: string;
  deliveryMode: 'IMAGE' | 'TEXT';
  caption?: string;
  text?: string;
  imageUrl?: string | null;
};

export type EvolutionPayload = {
  url: string;
  body: string;
  method: string;
};

export const buildEvolutionMessagePayload = (
  options: EvolutionPayloadOptions,
): EvolutionPayload => {
  let urlObj: URL;
  try {
    urlObj = new URL(options.baseUrl);
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      throw new Error();
    }
  } catch {
    throw new Error('COMMERCIAL_EVOLUTION_INVALID_BASE_URL');
  }

  if (!options.instanceName?.trim()) {
    throw new Error('COMMERCIAL_EVOLUTION_INVALID_INSTANCE_NAME');
  }

  if (!options.destination?.trim()) {
    throw new Error('COMMERCIAL_EVOLUTION_INVALID_DESTINATION');
  }

  const content = options.caption ?? options.text ?? '';
  if (!content.trim()) {
    throw new Error('COMMERCIAL_EVOLUTION_INVALID_CONTENT');
  }

  const normalizedBaseUrl = options.baseUrl.replace(/\/+$/, '');

  if (options.deliveryMode === 'IMAGE') {
    if (
      !options.imageUrl ||
      /[\u0000-\u001f\u007f]/u.test(options.imageUrl)
    ) {
      throw new Error('COMMERCIAL_EVOLUTION_INVALID_IMAGE_URL');
    }
    try {
      const imgUrl = new URL(options.imageUrl);
      if (imgUrl.protocol !== 'http:' && imgUrl.protocol !== 'https:') {
        throw new Error();
      }
    } catch {
      throw new Error('COMMERCIAL_EVOLUTION_INVALID_IMAGE_URL');
    }

    return {
      method: 'POST',
      url: `${normalizedBaseUrl}/message/sendMedia/${encodeURIComponent(options.instanceName)}`,
      body: JSON.stringify({
        number: options.destination,
        mediatype: 'image',
        media: options.imageUrl,
        caption: content,
      }),
    };
  }

  return {
    method: 'POST',
    url: `${normalizedBaseUrl}/message/sendText/${encodeURIComponent(options.instanceName)}`,
    body: JSON.stringify({
      number: options.destination,
      text: content,
    }),
  };
};
