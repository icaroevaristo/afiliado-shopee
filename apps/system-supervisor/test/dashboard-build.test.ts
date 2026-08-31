import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  dashboardBuildStampPath,
  ensureDashboardProductionBuild,
} from '../src/dashboard-build';
import {
  createServiceSpecs,
  resolveServiceArgs,
  resolveServiceEnv,
} from '../src/supervisor';
import type {
  CommandResult,
  CommandSpec,
  SystemDependencies,
} from '../src/types';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const createRoot = () => {
  const root = mkdtempSync(
    join(process.env.TEMP ?? process.cwd(), 'dashboard-build-'),
  );
  directories.push(root);
  mkdirSync(join(root, 'apps', 'dashboard', '.next'), { recursive: true });
  return root;
};

const createBuildHarness = (
  options: { buildFails?: boolean; statusAfterBuild?: string } = {},
) => {
  let head = 'a'.repeat(40);
  let buildId = 'build-a';
  let repositoryStatus = '';
  const commands: CommandSpec[] = [];
  const root = createRoot();
  const run = async (spec: CommandSpec): Promise<CommandResult> => {
    commands.push(spec);
    if (spec.command === 'git' && spec.args[0] === 'rev-parse') {
      return { code: 0, stdout: `${head}\n`, stderr: '' };
    }
    if (spec.command === 'git' && spec.args[0] === 'status') {
      return { code: 0, stdout: repositoryStatus, stderr: '' };
    }
    if (spec.args.includes('build')) {
      if (options.buildFails) {
        return { code: 1, stdout: '', stderr: 'build failed' };
      }
      mkdirSync(join(root, 'apps', 'dashboard', '.next'), { recursive: true });
      writeFileSync(
        join(root, 'apps', 'dashboard', '.next', 'BUILD_ID'),
        `${buildId}\n`,
      );
      if (options.statusAfterBuild !== undefined) {
        repositoryStatus = options.statusAfterBuild;
      }
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const deps = { run } as Pick<SystemDependencies, 'run'>;
  const buildCommand: CommandSpec = {
    command: 'pnpm',
    args: ['--filter', '@shopee-auto-affiliate-ai/dashboard', 'build'],
    cwd: root,
    env: {
      NODE_ENV: 'production',
      LOCAL_API_AUTH_TOKEN: 'TEST_SECRET_MUST_NEVER_APPEAR',
    },
  };
  return {
    root,
    deps,
    buildCommand,
    commands,
    setHead: (value: string) => {
      head = value;
    },
    setBuildId: (value: string) => {
      buildId = value;
    },
    setRepositoryStatus: (value: string) => {
      repositoryStatus = value;
    },
    setPublicApiUrl: (value: string | undefined) => {
      if (value === undefined) {
        delete buildCommand.env?.NEXT_PUBLIC_API_URL;
      } else {
        buildCommand.env = {
          ...buildCommand.env,
          NEXT_PUBLIC_API_URL: value,
        };
      }
    },
  };
};

const ensure = (harness: ReturnType<typeof createBuildHarness>) =>
  ensureDashboardProductionBuild({
    root: harness.root,
    deps: harness.deps,
    runtimeEnv: { NODE_ENV: 'test' },
    buildCommand: harness.buildCommand,
  });

describe('dashboard production build lifecycle', () => {
  it('builds once and writes only non-secret stamp metadata', async () => {
    const harness = createBuildHarness();

    await expect(ensure(harness)).resolves.toMatchObject({
      rebuilt: true,
      head: 'a'.repeat(40),
      buildId: 'build-a',
    });

    const stamp = readFileSync(dashboardBuildStampPath(harness.root), 'utf8');
    expect(stamp).toContain('build-a');
    expect(stamp).not.toContain('TEST_SECRET_MUST_NEVER_APPEAR');
    expect(
      harness.commands.filter((command) => command.args.includes('build')),
    ).toHaveLength(1);
  });

  it('reuses a valid build for the same clean HEAD and BUILD_ID', async () => {
    const harness = createBuildHarness();

    await ensure(harness);
    await expect(ensure(harness)).resolves.toMatchObject({ rebuilt: false });

    expect(
      harness.commands.filter((command) => command.args.includes('build')),
    ).toHaveLength(1);
  });

  it('rebuilds when the allowlisted public build input changes', async () => {
    const harness = createBuildHarness();
    await ensure(harness);
    harness.setPublicApiUrl('http://127.0.0.1:3433');

    await expect(ensure(harness)).resolves.toMatchObject({ rebuilt: true });
    expect(
      harness.commands.filter((command) => command.args.includes('build')),
    ).toHaveLength(2);
  });

  it('rebuilds when a Next dashboard env file changes a public build input', async () => {
    const harness = createBuildHarness();
    await ensure(harness);
    const dashboardEnvPath = join(
      harness.root,
      'apps',
      'dashboard',
      '.env.local',
    );
    writeFileSync(
      dashboardEnvPath,
      [
        'NEXT_PUBLIC_API_URL=http://127.0.0.1:3433',
        'LOCAL_API_AUTH_TOKEN=TEST_SECRET_MUST_NEVER_APPEAR',
      ].join('\n'),
    );

    await expect(ensure(harness)).resolves.toMatchObject({ rebuilt: true });
    expect(
      harness.commands.filter((command) => command.args.includes('build')),
    ).toHaveLength(2);
    expect(
      readFileSync(dashboardBuildStampPath(harness.root), 'utf8'),
    ).not.toContain('TEST_SECRET_MUST_NEVER_APPEAR');
  });

  it('rebuilds after a new HEAD and removes only the dashboard build artifact', async () => {
    const harness = createBuildHarness();
    await ensure(harness);
    writeFileSync(
      join(harness.root, 'apps', 'dashboard', '.next', 'stale.txt'),
      'stale',
    );
    harness.setHead('b'.repeat(40));
    harness.setBuildId('build-b');

    await expect(ensure(harness)).resolves.toMatchObject({
      rebuilt: true,
      head: 'b'.repeat(40),
      buildId: 'build-b',
    });
    expect(
      existsSync(join(harness.root, 'apps', 'dashboard', '.next', 'stale.txt')),
    ).toBe(false);
    expect(
      harness.commands.filter((command) => command.args.includes('build')),
    ).toHaveLength(2);
  });

  it.each([
    [
      'missing BUILD_ID',
      (harness: ReturnType<typeof createBuildHarness>) =>
        rmSync(join(harness.root, 'apps', 'dashboard', '.next', 'BUILD_ID'), {
          force: true,
        }),
    ],
    [
      'missing stamp',
      (harness: ReturnType<typeof createBuildHarness>) =>
        rmSync(dashboardBuildStampPath(harness.root), { force: true }),
    ],
  ])('%s triggers a rebuild', async (_caseName, invalidate) => {
    const harness = createBuildHarness();
    await ensure(harness);
    invalidate(harness);

    await expect(ensure(harness)).resolves.toMatchObject({ rebuilt: true });
    expect(
      harness.commands.filter((command) => command.args.includes('build')),
    ).toHaveLength(2);
  });

  it('fails closed before rebuilding a dirty worktree', async () => {
    const harness = createBuildHarness();
    await ensure(harness);
    harness.setRepositoryStatus(' M apps/dashboard/app/page.tsx\n');

    await expect(ensure(harness)).rejects.toMatchObject({
      code: 'DASHBOARD_BUILD_INPUT_DIRTY',
    });
    expect(
      harness.commands.filter((command) => command.args.includes('build')),
    ).toHaveLength(1);
  });

  it('rejects a worktree change observed during the build', async () => {
    const harness = createBuildHarness({
      statusAfterBuild: ' M apps/dashboard/app/page.tsx\n',
    });

    await expect(ensure(harness)).rejects.toMatchObject({
      code: 'DASHBOARD_BUILD_INPUT_CHANGED',
    });
    expect(existsSync(dashboardBuildStampPath(harness.root))).toBe(false);
  });

  it('fails before any service spawn when the production build fails', async () => {
    const harness = createBuildHarness({ buildFails: true });

    await expect(ensure(harness)).rejects.toMatchObject({
      code: 'DASHBOARD_BUILD_FAILED',
    });
    expect(existsSync(dashboardBuildStampPath(harness.root))).toBe(false);
  });

  it('invalidates the previous stamp before a rebuild can fail', async () => {
    const successful = createBuildHarness();
    await ensure(successful);

    const failing = createBuildHarness({ buildFails: true });
    failing.setHead('b'.repeat(40));
    mkdirSync(dirname(dashboardBuildStampPath(failing.root)), {
      recursive: true,
    });
    writeFileSync(
      dashboardBuildStampPath(failing.root),
      JSON.stringify({
        version: 1,
        head: 'a'.repeat(40),
        buildId: 'build-a',
      }),
    );
    writeFileSync(
      join(failing.root, 'apps', 'dashboard', '.next', 'BUILD_ID'),
      'build-a\n',
    );

    await expect(ensure(failing)).rejects.toMatchObject({
      code: 'DASHBOARD_BUILD_FAILED',
    });
    expect(existsSync(dashboardBuildStampPath(failing.root))).toBe(false);
  });
});

describe('dashboard service specification', () => {
  it('uses production start and isolates NODE_ENV to the dashboard child', () => {
    const repositoryRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../..',
    );
    const specs = createServiceSpecs(repositoryRoot);
    const dashboard = specs.find((spec) => spec.name === 'dashboard');
    const api = specs.find((spec) => spec.name === 'api');
    if (!dashboard || !api) throw new Error('dashboard specs missing');

    const ports = {
      api: 3433,
      dashboard: 3100,
      postgres: 5432,
      redis: 6379,
      evolution: 8080,
    };
    const dashboardArgs = resolveServiceArgs(dashboard, ports);
    expect(dashboardArgs).toContain('start');
    expect(dashboardArgs).not.toContain('dev');
    expect(dashboardArgs).toContain(resolve(repositoryRoot, 'apps/dashboard'));
    expect(dashboardArgs).toContain('3100');
    expect(
      resolveServiceEnv(dashboard, { NODE_ENV: 'nonstandard' }),
    ).toMatchObject({
      NODE_ENV: 'production',
    });
    expect(resolveServiceEnv(api, { NODE_ENV: 'nonstandard' })).toEqual({
      NODE_ENV: 'nonstandard',
    });
    const identity = dashboard.identity;
    expect(identity).toBeDefined();
    const quote = (value: string) =>
      value.includes(' ') ? `"${value}"` : value;
    const productionCommand = [process.execPath, ...dashboardArgs]
      .map(quote)
      .join(' ');
    expect(
      identity?.(
        {
          running: true,
          identityMatches: true,
          command: productionCommand,
        },
        ports,
      ),
    ).toBe(true);
    expect(
      identity?.(
        {
          running: true,
          identityMatches: true,
          command: productionCommand.replace(' start ', ' dev '),
        },
        ports,
      ),
    ).toBe(false);
    expect(
      identity?.(
        {
          running: true,
          identityMatches: true,
          command: productionCommand.replace(
            quote(dashboardArgs[2]),
            quote('C:/other-project/apps/dashboard'),
          ),
        },
        ports,
      ),
    ).toBe(false);
    expect(
      identity?.(
        {
          running: true,
          identityMatches: true,
          command: productionCommand.replace('3100', '3000'),
        },
        ports,
      ),
    ).toBe(false);
    expect(
      identity?.(
        {
          running: true,
          identityMatches: true,
          command: productionCommand.replace('127.0.0.1', '0.0.0.0'),
        },
        ports,
      ),
    ).toBe(false);
    expect(
      identity?.(
        {
          running: true,
          identityMatches: true,
          command: `${productionCommand} --port 3000`,
        },
        ports,
      ),
    ).toBe(false);
    expect(
      identity?.(
        {
          running: true,
          identityMatches: true,
          command: `${productionCommand} --hostname 0.0.0.0`,
        },
        ports,
      ),
    ).toBe(false);
    expect(
      identity?.(
        {
          running: true,
          identityMatches: true,
          command: productionCommand.replace(
            quote(dashboardArgs[0]),
            quote('C:/other-project/node_modules/next/dist/bin/next'),
          ),
        },
        ports,
      ),
    ).toBe(false);
    expect(
      identity?.(
        {
          running: true,
          identityMatches: true,
          command: `${quote(process.execPath)} -e "require(${quote(dashboardArgs[0])})" ${dashboardArgs.slice(1).map(quote).join(' ')}`,
        },
        ports,
      ),
    ).toBe(false);
    expect(
      identity?.(
        {
          running: true,
          identityMatches: true,
          command: `${productionCommand} unexpected-positional-argument`,
        },
        ports,
      ),
    ).toBe(false);
  });
});
