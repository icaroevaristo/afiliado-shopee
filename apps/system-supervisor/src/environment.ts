import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDotEnv } from '@shopee-auto-affiliate-ai/config';

import type { AutomationMode } from './types';
import { LocalSystemError } from './types';

const integerPort = (value: string | undefined, fallback: number) => {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new LocalSystemError(
      'Porta configurada fora do intervalo permitido',
      'SYSTEM_INVALID_PORT',
    );
  }
  return parsed;
};

export const loadLocalSystemEnvironment = (
  root: string,
  processEnv: NodeJS.ProcessEnv = process.env,
) => {
  const envPath = resolve(root, '.env');
  const runtimeEnvPath = resolve(root, 'runtime.env');
  const fileEnv = existsSync(envPath)
    ? parseDotEnv(readFileSync(envPath, 'utf8'))
    : {};
  const runtimeFileEnv = existsSync(runtimeEnvPath)
    ? parseDotEnv(readFileSync(runtimeEnvPath, 'utf8'))
    : {};
  const env = { ...fileEnv, ...runtimeFileEnv, ...processEnv };
  const mode = (env.COMMERCIAL_AUTOMATION_MODE ?? 'preview').toLowerCase();
  if (mode !== 'preview' && mode !== 'send') {
    throw new LocalSystemError(
      'COMMERCIAL_AUTOMATION_MODE deve ser preview ou send',
      'SYSTEM_INVALID_AUTOMATION_MODE',
    );
  }
  return {
    env,
    mode: mode as AutomationMode,
    ports: {
      api: integerPort(env.PORT, 3333),
      dashboard: 3000,
      postgres: 5432,
      redis: 6379,
      evolution: integerPort(env.EVOLUTION_HOST_PORT, 8080),
    },
  };
};
