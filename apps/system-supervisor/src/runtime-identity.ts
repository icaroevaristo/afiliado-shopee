import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

export const OPERATIONAL_COMPOSE_PROJECT_NAME = 'afiliado-shopee';
export const OPERATIONAL_EVOLUTION_COMPOSE_PROJECT_NAME =
  'shopee-evolution-local';
export const MAIN_POSTGRES_VOLUME_KEY = 'postgres_data';

const COMPOSE_PROJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export const isValidComposeProjectName = (value: string) =>
  value.length <= 63 && COMPOSE_PROJECT_NAME_PATTERN.test(value);

export const postgresVolumeName = (projectName: string) =>
  `${projectName}_${MAIN_POSTGRES_VOLUME_KEY}`;

/**
 * Operations for one Compose project must be serialized outside a checkout.
 * A temp-rooted path is deliberately used only for the supervisor lock; the
 * project name, rather than the worktree path, remains the identity boundary.
 */
export const composeProjectRuntimeRoot = (projectName: string) =>
  resolve(tmpdir(), 'afiliado-shopee-supervisor', projectName);

export const mainComposeArguments = (
  projectName: string,
  commandArguments: readonly string[] = [],
) => ['compose', '--project-name', projectName, ...commandArguments];

export const evolutionComposeArguments = (
  commandArguments: readonly string[] = [],
) => [
  'compose',
  '--project-name',
  OPERATIONAL_EVOLUTION_COMPOSE_PROJECT_NAME,
  '--env-file',
  'infra/evolution/.env.local',
  '-f',
  'infra/evolution/docker-compose.yml',
  ...commandArguments,
];
