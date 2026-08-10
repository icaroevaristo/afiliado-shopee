import { ImageOff } from 'lucide-react';

export const isLocalAssetUrl = (source?: string | null) => {
  const value = source?.trim();
  if (!value) return false;
  if (value.startsWith('/')) return true;
  if (typeof window === 'undefined') return false;

  try {
    const url = new URL(value, window.location.origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === window.location.origin
    );
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
  if (isLocalAssetUrl(src)) {
    return <img className={className} src={src ?? undefined} alt={alt} width={192} height={192} />;
  }

  return (
    <span
      className={`safe-product-image-fallback ${className}`}
      role="img"
      aria-label="Imagem externa indisponivel no modo local"
    >
      <ImageOff size={18} aria-hidden="true" />
    </span>
  );
}
