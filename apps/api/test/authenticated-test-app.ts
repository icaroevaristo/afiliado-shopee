import {
  buildApp,
  type BuildAppOptions,
} from '../src/app';

export const TEST_LOCAL_API_AUTH_TOKEN = 'local-api-test-token';

export const buildAuthenticatedTestApp = async (
  options: BuildAppOptions = {},
) => {
  const app = await buildApp({
    ...options,
    localApiAuthToken: TEST_LOCAL_API_AUTH_TOKEN,
  });
  const inject = app.inject.bind(app);

  app.inject = ((options: unknown, callback?: unknown) => {
    if (!options || typeof options !== 'object') {
      return callback === undefined
        ? inject(options as never)
        : inject(options as never, callback as never);
    }

    const request = options as { headers?: Record<string, unknown> };
    const authenticatedRequest = {
      ...request,
      headers: {
        authorization: `Bearer ${TEST_LOCAL_API_AUTH_TOKEN}`,
        ...request.headers,
      },
    };
    return callback === undefined
      ? inject(authenticatedRequest as never)
      : inject(authenticatedRequest as never, callback as never);
  }) as typeof app.inject;

  return app;
};
