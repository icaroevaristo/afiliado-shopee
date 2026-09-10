export type EvolutionErrorDiagnostic = {
  bodyFormat: 'JSON' | 'NON_JSON' | 'EMPTY' | 'TRUNCATED' | 'UNAVAILABLE';
  classification:
    | 'MEDIA_PROCESSING_ERROR'
    | 'SESSION_UNAVAILABLE'
    | 'AUTHENTICATION_REJECTED'
    | 'INVALID_REQUEST'
    | 'INTERNAL_ERROR'
    | 'UNKNOWN';
  observedErrorFields: string[];
};

const MAX_BODY_BYTES = 2048;
const READ_TIMEOUT_MS = 100;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

// External text never crosses this boundary. Only bounded classifications and
// known field names are returned; even an unknown secret format is discarded.
export const readEvolutionErrorDiagnostic = async (
  response: Response,
): Promise<EvolutionErrorDiagnostic> => {
  const diagnostic: EvolutionErrorDiagnostic = {
    bodyFormat: 'UNAVAILABLE',
    classification: 'UNKNOWN',
    observedErrorFields: [],
  };
  if (!response.body) return { ...diagnostic, bodyFormat: 'EMPTY' };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    reader = response.body.getReader();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('DIAGNOSTIC_TIMEOUT')),
        READ_TIMEOUT_MS,
      );
    });
    const bytes = new Uint8Array(MAX_BODY_BYTES);
    let length = 0;
    while (true) {
      const next = await Promise.race([reader.read(), timeout]);
      if (next.done) break;
      if (next.value.byteLength > MAX_BODY_BYTES - length) {
        return { ...diagnostic, bodyFormat: 'TRUNCATED' };
      }
      bytes.set(next.value, length);
      length += next.value.byteLength;
    }
    if (length === 0) return { ...diagnostic, bodyFormat: 'EMPTY' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes.subarray(0, length)));
    } catch {
      return { ...diagnostic, bodyFormat: 'NON_JSON' };
    }
    diagnostic.bodyFormat = 'JSON';
    const body = record(parsed);
    const fields = [
      ['error', body?.error],
      ['message', body?.message],
      ['response.message', record(body?.response)?.message],
    ] as const;
    const texts: string[] = [];
    for (const [name, value] of fields) {
      const values = Array.isArray(value) ? value.slice(0, 4) : [value];
      const strings = values.filter(
        (item): item is string => typeof item === 'string',
      );
      if (strings.length) diagnostic.observedErrorFields.push(name);
      texts.push(...strings.map((value) => value.slice(0, 256).toLowerCase()));
    }
    const text = texts.join(' ');
    if (
      /invalid image|unsupported image|unsupported media|image buffer|media upload|failed to decrypt/.test(
        text,
      )
    ) {
      diagnostic.classification = 'MEDIA_PROCESSING_ERROR';
    } else if (
      /connection closed|not connected|connection failure|session closed/.test(
        text,
      )
    ) {
      diagnostic.classification = 'SESSION_UNAVAILABLE';
    } else if (/unauthorized|forbidden|invalid api.?key/.test(text)) {
      diagnostic.classification = 'AUTHENTICATION_REJECTED';
    } else if (/bad request|validation failed/.test(text)) {
      diagnostic.classification = 'INVALID_REQUEST';
    } else if (/internal server error|cannot read properties/.test(text)) {
      diagnostic.classification = 'INTERNAL_ERROR';
    }
    return diagnostic;
  } catch {
    return diagnostic;
  } finally {
    if (timer) clearTimeout(timer);
    if (reader) {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
};
