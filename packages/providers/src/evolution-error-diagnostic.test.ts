import { describe, expect, it } from 'vitest';
import { readEvolutionErrorDiagnostic } from './evolution-error-diagnostic';

describe('bounded Evolution failure diagnostic', () => {
  it('keeps only classifications and field names, including when secrets and PII are embedded', async () => {
    const result = await readEvolutionErrorDiagnostic(
      new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          response: {
            message: [
              'invalid image buffer secret-unrecognized-format 5511999999999 120000000000@g.us https://private.invalid/?token=secret Authorization: Bearer sensitive',
            ],
          },
          apikey: 'test-api-key-never-log',
          stack: 'private stack',
        }),
        { status: 500 },
      ),
    );
    expect(result).toEqual({
      bodyFormat: 'JSON',
      classification: 'MEDIA_PROCESSING_ERROR',
      observedErrorFields: ['error', 'response.message'],
    });
    for (const forbidden of [
      'secret',
      '551199',
      '120000',
      'https:',
      'Bearer',
      'apikey',
      'stack',
      'sensitive',
    ]) {
      expect(JSON.stringify(result)).not.toContain(forbidden);
    }
  });

  it.each([
    [400, 'Bad Request', 'INVALID_REQUEST'],
    [401, 'Unauthorized', 'AUTHENTICATION_REJECTED'],
    [500, 'Connection Closed', 'SESSION_UNAVAILABLE'],
    [500, 'Internal Server Error', 'INTERNAL_ERROR'],
    [500, 'unrecognized value', 'UNKNOWN'],
  ])(
    'classifies %i without returning arbitrary external text',
    async (status, message, classification) => {
      expect(
        await readEvolutionErrorDiagnostic(
          new Response(JSON.stringify({ message }), { status }),
        ),
      ).toEqual({
        bodyFormat: 'JSON',
        classification,
        observedErrorFields: ['message'],
      });
    },
  );

  it.each(['<html>private text</html>', '{broken json'])(
    'does not expose malformed/non-JSON bodies',
    async (body) => {
      expect(
        await readEvolutionErrorDiagnostic(new Response(body, { status: 500 })),
      ).toEqual({
        bodyFormat: 'NON_JSON',
        classification: 'UNKNOWN',
        observedErrorFields: [],
      });
    },
  );

  it('bounds bytes and cancels an oversized response', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(2049)));
      },
      cancel() {
        cancelled = true;
      },
    });
    expect(
      await readEvolutionErrorDiagnostic(new Response(body, { status: 500 })),
    ).toEqual({
      bodyFormat: 'TRUNCATED',
      classification: 'UNKNOWN',
      observedErrorFields: [],
    });
    expect(cancelled).toBe(true);
  });

  it('bounds a stalled body and does not wait for a stalled cancellation', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise(() => undefined);
      },
      cancel() {
        return new Promise(() => undefined);
      },
    });
    const started = Date.now();
    expect(
      (await readEvolutionErrorDiagnostic(new Response(body, { status: 500 })))
        .bodyFormat,
    ).toBe('UNAVAILABLE');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
