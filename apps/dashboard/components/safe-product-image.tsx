'use client';

import { ImageOff } from 'lucide-react';
import { useEffect, useState } from 'react';

const IMAGE_PROTOCOLS = new Set(['http:', 'https:']);
const PROTOCOL_PATTERN = /^[a-z][a-z\d+.-]*:/i;

export const isSafeImageUrl = (
  source?: string | null,
  origin = typeof window === 'undefined' ? 'http://dashboard.local' : window.location.origin,
) => {
  const value = source?.trim();
  if (!value || value.startsWith('//')) return false;

  try {
    const url = new URL(value, origin);
    if (!IMAGE_PROTOCOLS.has(url.protocol)) return false;

    if (!PROTOCOL_PATTERN.test(value) || url.origin === origin) return true;
    return url.protocol === 'https:';
  } catch {
    return false;
  }
};

export function SafeProductImage({
  src,
  alt = '',
  className = '',
}: {
  src?: string | null;
  alt?: string;
  className?: string;
}) {
  const value = src?.trim() ?? '';
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const shouldRenderImage = isSafeImageUrl(value) && failedSource !== value;

  useEffect(() => {
    setFailedSource(null);
  }, [value]);

  if (!shouldRenderImage) {
    return (
      <span
        className={`safe-product-image-fallback ${className}`}
        role="img"
        aria-label="Imagem do produto indisponível"
      >
        <ImageOff size={18} aria-hidden="true" />
      </span>
    );
  }

  return (
    <img
      className={className}
      src={value}
      alt={alt}
      width={192}
      height={192}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedSource(value)}
    />
  );
}
