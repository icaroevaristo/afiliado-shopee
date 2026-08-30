import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from 'openai';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';

import {
  buildCommercialAiCopyInput,
  buildCommercialAiCopyInstructions,
  COMMERCIAL_AI_COPY_REMOTE_SCHEMA,
  type CommercialAiCopyFacts,
} from './commercial-ai-copy-prompt';

export type CommercialAiCopyOutput = {
  headline: string;
  body: string;
};

export type CommercialAiCopyProviderResult = {
  output: CommercialAiCopyOutput;
  provider: 'openai';
  model: string;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    reasoningTokens: number | null;
  };
};

export type CommercialAiCopyProviderUsage =
  CommercialAiCopyProviderResult['usage'];

export interface CommercialAiCopyProvider {
  generate(
    input: CommercialAiCopyFacts,
  ): Promise<CommercialAiCopyProviderResult>;
}

export type CommercialAiCopyProviderFailureKind =
  'NOT_STARTED' | 'FAILED_CONFIRMED' | 'AMBIGUOUS';

const PROVIDER_METADATA_VALUE = /^[A-Za-z0-9._-]{1,100}$/u;
const PROVIDER_METADATA_PARAM = /^[A-Za-z0-9._\-[\]]{1,100}$/u;

const sanitizeProviderMetadataValue = (
  value: unknown,
  allowBrackets = false,
) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100) {
    return undefined;
  }
  const pattern = allowBrackets
    ? PROVIDER_METADATA_PARAM
    : PROVIDER_METADATA_VALUE;
  return pattern.test(value) ? value : undefined;
};

const sanitizeHttpStatus = (value: unknown) =>
  Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599
    ? Number(value)
    : undefined;

const PROVIDER_PUBLIC_CODES = new Set([
  'COMMERCIAL_OPENAI_DAILY_BUDGET_REACHED',
  'COMMERCIAL_AI_COPY_PROVIDER_NOT_STARTED',
  'COMMERCIAL_AI_COPY_PROVIDER_RESULT_AMBIGUOUS',
  'COMMERCIAL_AI_COPY_PROVIDER_FAILED',
  'COMMERCIAL_AI_COPY_REQUEST_INVALID',
  'COMMERCIAL_AI_COPY_AUTHENTICATION_FAILED',
  'COMMERCIAL_AI_COPY_ACCESS_DENIED',
  'COMMERCIAL_AI_COPY_MODEL_UNAVAILABLE',
  'COMMERCIAL_AI_COPY_QUOTA_EXCEEDED',
  'COMMERCIAL_AI_COPY_RATE_LIMITED',
  'COMMERCIAL_AI_COPY_PROVIDER_SERVER_ERROR',
  'COMMERCIAL_AI_COPY_PROVIDER_INCOMPLETE',
  'COMMERCIAL_AI_COPY_OUTPUT_TOKEN_LIMIT',
  'COMMERCIAL_AI_COPY_CONTENT_FILTERED',
  'COMMERCIAL_AI_COPY_PROVIDER_REFUSED',
  'COMMERCIAL_AI_COPY_PROVIDER_OUTPUT_INVALID',
]);

const normalizeCommercialAiCopyProviderPublicCode = (value: string) =>
  PROVIDER_PUBLIC_CODES.has(value)
    ? value
    : 'COMMERCIAL_AI_COPY_PROVIDER_FAILED';

export type CommercialAiCopyProviderErrorMetadata = {
  httpStatus?: number;
  providerErrorCode?: string;
  providerErrorType?: string;
  providerErrorParam?: string;
};

type CommercialAiCopyProviderUsageInput =
  Partial<CommercialAiCopyProviderUsage>;

const sanitizeUsageToken = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;

const sanitizeProviderUsage = (
  usage: CommercialAiCopyProviderUsageInput | null | undefined,
): CommercialAiCopyProviderUsage => ({
  inputTokens: sanitizeUsageToken(usage?.inputTokens),
  outputTokens: sanitizeUsageToken(usage?.outputTokens),
  totalTokens: sanitizeUsageToken(usage?.totalTokens),
  reasoningTokens: sanitizeUsageToken(usage?.reasoningTokens),
});

export const sanitizeCommercialAiCopyProviderErrorMetadata = (
  metadata: CommercialAiCopyProviderErrorMetadata = {},
): CommercialAiCopyProviderErrorMetadata => ({
  httpStatus: sanitizeHttpStatus(metadata.httpStatus),
  providerErrorCode: sanitizeProviderMetadataValue(metadata.providerErrorCode),
  providerErrorType: sanitizeProviderMetadataValue(metadata.providerErrorType),
  providerErrorParam: sanitizeProviderMetadataValue(
    metadata.providerErrorParam,
    true,
  ),
});

export class CommercialAiCopyProviderError extends Error {
  readonly publicCode: string;
  readonly httpStatus?: number;
  readonly providerErrorCode?: string;
  readonly providerErrorType?: string;
  readonly providerErrorParam?: string;
  readonly requestMayHaveStarted: boolean;
  readonly usage: CommercialAiCopyProviderUsage;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly reasoningTokens: number | null;

  constructor(
    readonly kind: CommercialAiCopyProviderFailureKind,
    publicCode: string,
    metadata: CommercialAiCopyProviderErrorMetadata = {},
    usage?: CommercialAiCopyProviderUsageInput,
    requestMayHaveStarted = kind === 'AMBIGUOUS',
  ) {
    const safePublicCode =
      normalizeCommercialAiCopyProviderPublicCode(publicCode);
    const safeMetadata =
      sanitizeCommercialAiCopyProviderErrorMetadata(metadata);
    super(safePublicCode);
    this.name = 'CommercialAiCopyProviderError';
    this.publicCode = safePublicCode;
    this.httpStatus = safeMetadata.httpStatus;
    this.providerErrorCode = safeMetadata.providerErrorCode;
    this.providerErrorType = safeMetadata.providerErrorType;
    this.providerErrorParam = safeMetadata.providerErrorParam;
    this.requestMayHaveStarted = requestMayHaveStarted;
    this.usage = sanitizeProviderUsage(usage);
    this.inputTokens = this.usage.inputTokens;
    this.outputTokens = this.usage.outputTokens;
    this.totalTokens = this.usage.totalTokens;
    this.reasoningTokens = this.usage.reasoningTokens;
  }
}

const providerErrorBody = (error: APIError) =>
  error.error && typeof error.error === 'object'
    ? (error.error as Record<string, unknown>)
    : undefined;

const firstSanitizedProviderMetadataValue = (
  values: unknown[],
  allowBrackets = false,
) => {
  for (const value of values) {
    const sanitized = sanitizeProviderMetadataValue(value, allowBrackets);
    if (sanitized) return sanitized;
  }
  return undefined;
};

const providerErrorMetadata = (error: APIError) => {
  const body = providerErrorBody(error);
  const httpStatus = sanitizeHttpStatus(error.status);
  return {
    httpStatus,
    providerErrorCode: firstSanitizedProviderMetadataValue([
      error.code,
      body?.code,
    ]),
    providerErrorType: firstSanitizedProviderMetadataValue([
      error.type,
      body?.type,
    ]),
    providerErrorParam: firstSanitizedProviderMetadataValue(
      [error.param, body?.param],
      true,
    ),
  } satisfies CommercialAiCopyProviderErrorMetadata;
};

const lowerCaseProviderMarker = (value: string | undefined) =>
  value?.toLocaleLowerCase('en-US');

const isQuotaMarker = (value: string | undefined) => {
  const marker = lowerCaseProviderMarker(value);
  return Boolean(
    marker &&
    (marker === 'insufficient_quota' ||
      marker === 'quota_exceeded' ||
      marker === 'billing_hard_limit_reached' ||
      marker === 'insufficient_balance' ||
      marker === 'insufficient_funds' ||
      marker.includes('quota') ||
      marker.includes('saldo') ||
      marker.includes('balance')),
  );
};

const isModelMarker = (value: string | undefined) => {
  const marker = lowerCaseProviderMarker(value);
  return Boolean(
    marker &&
    (marker === 'model_not_found' ||
      marker === 'model_not_found_error' ||
      marker === 'model_unavailable'),
  );
};

const isModelParam = (value: string | undefined) => {
  const marker = lowerCaseProviderMarker(value);
  return Boolean(marker && /^model(?:[._\-[\]]|$)/u.test(marker));
};

export type CommercialAiCopyProviderErrorClassification = {
  publicCode: string;
  metadata: CommercialAiCopyProviderErrorMetadata;
};

export const classifyOpenAiApiError = (
  error: APIError,
): CommercialAiCopyProviderErrorClassification => {
  const metadata = providerErrorMetadata(error);
  const markers = [metadata.providerErrorCode, metadata.providerErrorType];
  let publicCode = 'COMMERCIAL_AI_COPY_PROVIDER_FAILED';

  if (metadata.httpStatus === 400) {
    publicCode = 'COMMERCIAL_AI_COPY_REQUEST_INVALID';
  } else if (metadata.httpStatus === 401) {
    publicCode = 'COMMERCIAL_AI_COPY_AUTHENTICATION_FAILED';
  } else if (metadata.httpStatus === 403) {
    publicCode = 'COMMERCIAL_AI_COPY_ACCESS_DENIED';
  } else if (
    metadata.httpStatus === 404 &&
    (isModelParam(metadata.providerErrorParam) || markers.some(isModelMarker))
  ) {
    publicCode = 'COMMERCIAL_AI_COPY_MODEL_UNAVAILABLE';
  } else if (metadata.httpStatus === 429) {
    publicCode = markers.some(isQuotaMarker)
      ? 'COMMERCIAL_AI_COPY_QUOTA_EXCEEDED'
      : 'COMMERCIAL_AI_COPY_RATE_LIMITED';
  } else if (
    metadata.httpStatus === 500 ||
    metadata.httpStatus === 502 ||
    metadata.httpStatus === 503 ||
    metadata.httpStatus === 504
  ) {
    publicCode = 'COMMERCIAL_AI_COPY_PROVIDER_SERVER_ERROR';
  } else if (
    markers.some(
      (marker) => lowerCaseProviderMarker(marker) === 'invalid_request_error',
    )
  ) {
    publicCode = 'COMMERCIAL_AI_COPY_REQUEST_INVALID';
  }

  return { publicCode, metadata };
};

export const normalizeCommercialAiCopyModel = (
  model: string | null | undefined,
) => {
  if (typeof model !== 'string') return 'unknown';
  const normalized = model.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  return sanitizeProviderMetadataValue(normalized) ?? 'unknown';
};

type ResponseLike = {
  status?: string;
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string }> }>;
  incomplete_details?: { reason?: string } | null;
  error?: { code?: string } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number } | null;
  } | null;
};

export type OpenAiResponsesClient = {
  responses: {
    create(input: ResponseCreateParamsNonStreaming): Promise<ResponseLike>;
  };
};

export type OpenAiCommercialAiCopyProviderOptions = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  reasoningEffort: CommercialAiCopyReasoningEffort;
  client?: OpenAiResponsesClient;
};

export type CommercialAiCopyReasoningEffort = NonNullable<
  NonNullable<ResponseCreateParamsNonStreaming['reasoning']>['effort']
>;

const hasRefusal = (response: ResponseLike) =>
  response.output?.some(
    (item) =>
      item.type === 'message' &&
      item.content?.some((content) => content.type === 'refusal'),
  ) ?? false;

const responseUsage = (response: ResponseLike): CommercialAiCopyProviderUsage =>
  sanitizeProviderUsage({
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
    totalTokens: response.usage?.total_tokens,
    reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens,
  });

const incompleteReason = (response: ResponseLike) =>
  sanitizeProviderMetadataValue(response.incomplete_details?.reason);

const responseFailureCode = (
  response: ResponseLike,
  reason: string | undefined,
  refusal: boolean,
) => {
  if (response.status === 'incomplete') {
    if (reason === 'max_output_tokens') {
      return 'COMMERCIAL_AI_COPY_OUTPUT_TOKEN_LIMIT';
    }
    if (reason === 'content_filter') {
      return 'COMMERCIAL_AI_COPY_CONTENT_FILTERED';
    }
    return 'COMMERCIAL_AI_COPY_PROVIDER_INCOMPLETE';
  }
  if (response.status === 'failed') {
    return 'COMMERCIAL_AI_COPY_PROVIDER_FAILED';
  }
  if (response.status === 'completed' && refusal) {
    return 'COMMERCIAL_AI_COPY_PROVIDER_REFUSED';
  }
  return 'COMMERCIAL_AI_COPY_PROVIDER_INCOMPLETE';
};

export class OpenAiCommercialAiCopyProvider implements CommercialAiCopyProvider {
  private readonly client: OpenAiResponsesClient;

  constructor(private readonly options: OpenAiCommercialAiCopyProviderOptions) {
    this.client =
      options.client ??
      (new OpenAI({
        apiKey: options.apiKey,
        maxRetries: 0,
        timeout: options.timeoutMs,
      }) as OpenAiResponsesClient);
  }

  async generate(
    input: CommercialAiCopyFacts,
  ): Promise<CommercialAiCopyProviderResult> {
    let requestStarted = false;
    try {
      const request: ResponseCreateParamsNonStreaming = {
        model: this.options.model,
        instructions: buildCommercialAiCopyInstructions(),
        input: buildCommercialAiCopyInput(input),
        max_output_tokens: this.options.maxOutputTokens,
        reasoning: { effort: this.options.reasoningEffort },
        store: false,
        stream: false,
        background: false,
        text: {
          format: {
            type: 'json_schema',
            name: 'commercial_promotion_copy',
            strict: true,
            schema: COMMERCIAL_AI_COPY_REMOTE_SCHEMA,
          },
        },
      };
      requestStarted = true;
      const response = await this.client.responses.create(request);
      const usage = responseUsage(response);
      const refusal = hasRefusal(response);
      if (response.status !== 'completed' || refusal) {
        const reason = incompleteReason(response);
        const publicCode = responseFailureCode(response, reason, refusal);
        throw new CommercialAiCopyProviderError(
          'FAILED_CONFIRMED',
          publicCode,
          {
            providerErrorCode:
              response.status === 'incomplete'
                ? reason
                : sanitizeProviderMetadataValue(response.error?.code),
          },
          usage,
          true,
        );
      }
      let output: CommercialAiCopyOutput;
      try {
        output = JSON.parse(
          response.output_text ?? '',
        ) as CommercialAiCopyOutput;
      } catch {
        throw new CommercialAiCopyProviderError(
          'FAILED_CONFIRMED',
          'COMMERCIAL_AI_COPY_PROVIDER_OUTPUT_INVALID',
          {},
          usage,
          true,
        );
      }
      return {
        output,
        provider: 'openai',
        model: this.options.model,
        usage,
      };
    } catch (error) {
      if (error instanceof CommercialAiCopyProviderError) throw error;
      if (
        error instanceof APIUserAbortError ||
        error instanceof APIConnectionTimeoutError ||
        error instanceof APIConnectionError
      ) {
        throw new CommercialAiCopyProviderError(
          requestStarted ? 'AMBIGUOUS' : 'NOT_STARTED',
          requestStarted
            ? 'COMMERCIAL_AI_COPY_PROVIDER_RESULT_AMBIGUOUS'
            : 'COMMERCIAL_AI_COPY_PROVIDER_NOT_STARTED',
          {},
          undefined,
          requestStarted,
        );
      }
      if (error instanceof APIError) {
        const classification = classifyOpenAiApiError(error);
        throw new CommercialAiCopyProviderError(
          'FAILED_CONFIRMED',
          classification.publicCode,
          classification.metadata,
          undefined,
          requestStarted,
        );
      }
      throw new CommercialAiCopyProviderError(
        requestStarted ? 'AMBIGUOUS' : 'NOT_STARTED',
        requestStarted
          ? 'COMMERCIAL_AI_COPY_PROVIDER_RESULT_AMBIGUOUS'
          : 'COMMERCIAL_AI_COPY_PROVIDER_NOT_STARTED',
        {},
        undefined,
        requestStarted,
      );
    }
  }
}
