import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import { parseDotEnv } from '@shopee-auto-affiliate-ai/config';

import { appendSupervisorLog, runtimeDirectory } from './state-store';
import type { CommandSpec, SystemDependencies } from './types';
import { LocalSystemError } from './types';

export const DASHBOARD_BUILD_STAMP_FILE = 'dashboard-production-build.json';

type DashboardBuildStamp = {
  version: 2;
  head: string;
  buildId: string;
  buildInputsFingerprint: string;
};

export type DashboardBuildResult = {
  rebuilt: boolean;
  head: string;
  buildId: string;
};

const dashboardDirectory = (root: string) => resolve(root, 'apps', 'dashboard');
const dashboardNextDirectory = (root: string) =>
  resolve(dashboardDirectory(root), '.next');
const dashboardBuildIdPath = (root: string) =>
  resolve(dashboardNextDirectory(root), 'BUILD_ID');
export const dashboardBuildStampPath = (root: string) =>
  resolve(runtimeDirectory(root), DASHBOARD_BUILD_STAMP_FILE);

const dashboardBuildEnvFiles = [
  '.env.production.local',
  '.env.local',
  '.env.production',
  '.env',
] as const;

const isPublicBuildInput = (key: string) => key.startsWith('NEXT_PUBLIC_');

const publicEnvironmentEntries = (environment: NodeJS.ProcessEnv) =>
  Object.entries(environment)
    .filter(([key]) => isPublicBuildInput(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, value ?? null]);

const dashboardFileBuildInputs = (root: string) =>
  dashboardBuildEnvFiles.map((fileName) => {
    const path = resolve(dashboardDirectory(root), fileName);
    if (!existsSync(path)) return [fileName, null];
    let parsed: NodeJS.ProcessEnv;
    try {
      parsed = parseDotEnv(readFileSync(path, 'utf8'));
    } catch {
      return [fileName, 'unreadable'];
    }
    return [fileName, publicEnvironmentEntries(parsed)];
  });

const buildInputsFingerprint = (root: string, environment: NodeJS.ProcessEnv) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        environment: publicEnvironmentEntries(environment),
        files: dashboardFileBuildInputs(root),
      }),
    )
    .digest('hex');

const runReadOnly = async (
  deps: Pick<SystemDependencies, 'run'>,
  spec: CommandSpec,
) => deps.run(spec).catch(() => ({ code: 1, stdout: '', stderr: '' }));

const validHash = (value: string) => /^[0-9a-f]{7,64}$/i.test(value);

const readRepositoryHead = async (
  root: string,
  deps: Pick<SystemDependencies, 'run'>,
  environment: NodeJS.ProcessEnv,
) => {
  const result = await runReadOnly(deps, {
    command: 'git',
    args: ['rev-parse', 'HEAD'],
    cwd: root,
    env: environment,
  });
  const head = result.stdout.trim();
  if (result.code !== 0 || !validHash(head)) {
    throw new LocalSystemError(
      'Nao foi possivel identificar a revisao do dashboard',
      'DASHBOARD_BUILD_INPUT_UNAVAILABLE',
    );
  }
  return head;
};

const readRepositoryStatus = async (
  root: string,
  deps: Pick<SystemDependencies, 'run'>,
  environment: NodeJS.ProcessEnv,
) => {
  const result = await runReadOnly(deps, {
    command: 'git',
    args: ['status', '--porcelain=v1', '--untracked-files=all', '--'],
    cwd: root,
    env: environment,
  });
  if (result.code !== 0) {
    throw new LocalSystemError(
      'Nao foi possivel validar o estado local do dashboard',
      'DASHBOARD_BUILD_INPUT_UNAVAILABLE',
    );
  }
  return result.stdout.trim();
};

const readBuildId = (root: string) => {
  try {
    const value = readFileSync(dashboardBuildIdPath(root), 'utf8').trim();
    return value && value.length <= 256 && !/[\r\n]/.test(value) ? value : null;
  } catch {
    return null;
  }
};

const readBuildStamp = (root: string): DashboardBuildStamp | null => {
  try {
    const parsed = JSON.parse(
      readFileSync(dashboardBuildStampPath(root), 'utf8'),
    ) as Record<string, unknown>;
    if (
      parsed.version !== 2 ||
      typeof parsed.head !== 'string' ||
      !validHash(parsed.head) ||
      typeof parsed.buildId !== 'string' ||
      !parsed.buildId ||
      parsed.buildId.length > 256 ||
      /[\r\n]/.test(parsed.buildId) ||
      typeof parsed.buildInputsFingerprint !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(parsed.buildInputsFingerprint)
    ) {
      return null;
    }
    return {
      version: 2,
      head: parsed.head,
      buildId: parsed.buildId,
      buildInputsFingerprint: parsed.buildInputsFingerprint,
    };
  } catch {
    return null;
  }
};

const writeBuildStamp = (
  root: string,
  head: string,
  buildId: string,
  fingerprint: string,
) => {
  const path = dashboardBuildStampPath(root);
  mkdirSync(dirname(path), { recursive: true });
  const stamp: DashboardBuildStamp = {
    version: 2,
    head,
    buildId,
    buildInputsFingerprint: fingerprint,
  };
  writeFileSync(path, `${JSON.stringify(stamp)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
};

export const ensureDashboardProductionBuild = async ({
  root,
  deps,
  runtimeEnv,
  buildCommand,
}: {
  root: string;
  deps: Pick<SystemDependencies, 'run'>;
  runtimeEnv: NodeJS.ProcessEnv;
  buildCommand: CommandSpec;
}): Promise<DashboardBuildResult> => {
  const head = await readRepositoryHead(root, deps, runtimeEnv);
  const repositoryStatus = await readRepositoryStatus(root, deps, runtimeEnv);
  if (repositoryStatus) {
    appendSupervisorLog(root, 'DASHBOARD_BUILD_INPUT_DIRTY');
    throw new LocalSystemError(
      'O codigo do dashboard possui alteracoes locais; atualize ou reverta antes de iniciar o sistema',
      'DASHBOARD_BUILD_INPUT_DIRTY',
    );
  }
  const currentBuildInputsFingerprint = buildInputsFingerprint(
    root,
    buildCommand.env ?? runtimeEnv,
  );
  const buildId = readBuildId(root);
  const stamp = readBuildStamp(root);
  if (
    !repositoryStatus &&
    buildId &&
    stamp?.head === head &&
    stamp.buildId === buildId &&
    stamp.buildInputsFingerprint === currentBuildInputsFingerprint
  ) {
    return { rebuilt: false, head, buildId };
  }

  rmSync(dashboardNextDirectory(root), { recursive: true, force: true });
  rmSync(dashboardBuildStampPath(root), { force: true });
  const buildResult = await runReadOnly(deps, buildCommand);
  if (buildResult.code !== 0) {
    appendSupervisorLog(root, 'DASHBOARD_BUILD_FAILED');
    throw new LocalSystemError(
      'Nao foi possivel preparar o painel. Consulte o log do sistema.',
      'DASHBOARD_BUILD_FAILED',
    );
  }

  const finalHead = await readRepositoryHead(root, deps, runtimeEnv);
  const finalRepositoryStatus = await readRepositoryStatus(
    root,
    deps,
    runtimeEnv,
  );
  const finalBuildId = readBuildId(root);
  const finalBuildInputsFingerprint = buildInputsFingerprint(
    root,
    buildCommand.env ?? runtimeEnv,
  );
  if (
    finalHead !== head ||
    finalRepositoryStatus !== repositoryStatus ||
    !finalBuildId ||
    finalBuildInputsFingerprint !== currentBuildInputsFingerprint
  ) {
    appendSupervisorLog(root, 'DASHBOARD_BUILD_INPUT_CHANGED');
    throw new LocalSystemError(
      'O codigo do dashboard mudou durante a preparacao do painel',
      'DASHBOARD_BUILD_INPUT_CHANGED',
    );
  }

  writeBuildStamp(root, finalHead, finalBuildId, finalBuildInputsFingerprint);
  return { rebuilt: true, head: finalHead, buildId: finalBuildId };
};
