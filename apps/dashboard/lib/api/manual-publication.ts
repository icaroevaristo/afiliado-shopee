import { apiRequest } from './client';
import type {
  ManualPublicationOptions,
  ManualPublicationRequest,
} from './types';

export const getManualPublicationOptions = (productId: string) =>
  apiRequest<ManualPublicationOptions>(
    `/commercial-publications/manual/options?productId=${encodeURIComponent(productId)}`,
  );

export const createManualPublication = (input: {
  idempotencyKey: string;
  productId: string;
  destinationIds: string[];
  confirm: 'ENVIAR_PUBLICACAO_MANUAL';
}) =>
  apiRequest<ManualPublicationRequest>('/commercial-publications/manual', {
    method: 'POST',
    body: input,
  });

export const getManualPublication = (requestId: string) =>
  apiRequest<ManualPublicationRequest>(
    `/commercial-publications/manual/${encodeURIComponent(requestId)}`,
  );
