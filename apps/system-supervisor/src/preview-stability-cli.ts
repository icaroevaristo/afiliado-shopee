import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runPreviewStabilityValidation } from './preview-stability';
import { createPreviewStabilityDependencies } from './preview-stability-runtime';
import { acquireLock, PREVIEW_STABILITY_PROCESS_MARKER } from './state-store';
import {
  composeProjectRuntimeRoot,
  OPERATIONAL_COMPOSE_PROJECT_NAME,
} from './runtime-identity';
import { createSystemDependencies } from './system-dependencies';
import { LocalSystemError } from './types';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export const runPreviewStabilityCli = async (
  args: readonly string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
) => {
  let release: (() => void) | undefined;
  try {
    const systemDependencies = createSystemDependencies();
    release = await acquireLock(
      composeProjectRuntimeRoot(OPERATIONAL_COMPOSE_PROJECT_NAME),
      'start',
      systemDependencies,
      { processMarker: PREVIEW_STABILITY_PROCESS_MARKER },
    );
    await runPreviewStabilityValidation({
      args,
      processEnvironment: environment,
      dependencies: createPreviewStabilityDependencies(
        ROOT,
        systemDependencies,
      ),
    });
    console.log(
      JSON.stringify({
        event: 'preview-stability.completed',
        report: '.runtime/local-system/preview-stability-report.json',
      }),
    );
    return 0;
  } catch (error) {
    const code =
      error instanceof LocalSystemError
        ? error.code
        : 'PREVIEW_STABILITY_UNEXPECTED_FAILURE';
    console.error(
      JSON.stringify({
        event: 'preview-stability.failed',
        code,
        report: '.runtime/local-system/preview-stability-report.json',
      }),
    );
    if (code === 'PREVIEW_STABILITY_INTERRUPTED_SIGINT') return 130;
    if (code === 'PREVIEW_STABILITY_INTERRUPTED_SIGTERM') return 143;
    return 1;
  } finally {
    release?.();
  }
};

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  void runPreviewStabilityCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
