import { createHash } from 'node:crypto';

export type CommercialOfferFingerprintInput = {
  source: 'MOCK' | 'MANUAL' | 'OFFICIAL';
  providerProductId: string;
  productLink: string | null;
  affiliateLink: string | null;
  price: string;
  priceMin?: string | null;
  priceMax?: string | null;
  discountRate: number;
  commissionRate: number;
  offerStartsAt?: Date | null;
  offerEndsAt?: Date | null;
  unavailableAt?: Date | null;
};

const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;

export const canonicalizeCommercialDecimal = (value: string): string => {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new TypeError('Commercial decimal must use a finite base-10 form');
  }
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart, decimalPart = ''] = unsigned.split('.');
  const integer = integerPart.replace(/^0+(?=\d)/, '');
  const decimal = decimalPart.replace(/0+$/, '');
  const magnitude = decimal.length > 0 ? `${integer}.${decimal}` : integer;
  return negative && magnitude !== '0' ? `-${magnitude}` : magnitude;
};

// Binary64 preserves at least 15 significant decimal digits; trim only representation noise beyond that.
const COMMERCIAL_NUMBER_SIGNIFICANT_DIGITS = 15;

const canonicalNumber = (value: number) => {
  if (!Number.isFinite(value)) {
    throw new TypeError('Commercial number must be finite');
  }
  if (Object.is(value, -0)) return '0';
  const persistenceStable = Number(
    value.toPrecision(COMMERCIAL_NUMBER_SIGNIFICANT_DIGITS),
  );
  return Object.is(persistenceStable, -0) ? '0' : String(persistenceStable);
};

const canonicalDate = (value: Date | null | undefined) => {
  if (value === null || value === undefined) return null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError('Commercial date must be valid');
  }
  return value.toISOString();
};

const canonicalNullableDecimal = (value: string | null | undefined) =>
  value === null || value === undefined
    ? null
    : canonicalizeCommercialDecimal(value);

export const fingerprintCommercialOffer = (
  input: CommercialOfferFingerprintInput,
): string => {
  const canonical = JSON.stringify({
    source: input.source,
    providerProductId: input.providerProductId,
    productLink: input.productLink,
    affiliateLink: input.affiliateLink,
    price: canonicalizeCommercialDecimal(input.price),
    priceMin: canonicalNullableDecimal(input.priceMin),
    priceMax: canonicalNullableDecimal(input.priceMax),
    discountRate: canonicalNumber(input.discountRate),
    commissionRate: canonicalNumber(input.commissionRate),
    offerStartsAt: canonicalDate(input.offerStartsAt),
    offerEndsAt: canonicalDate(input.offerEndsAt),
    unavailableAt: canonicalDate(input.unavailableAt),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
};
