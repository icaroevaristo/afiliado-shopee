import type { CommandResult, CommandSpec } from '../src/types';

/** Deterministic Docker boundary; real topology is exercised separately. */
export const maintenanceDockerFixture = () => {
  const state = {
    originalRunning: true,
    temporaryExists: false,
    temporaryRunning: false,
    canonicalStaysRunning: false,
    concurrentMount: false,
    port: 49153,
    host: '127.0.0.1',
    image: `sha256:${'a'.repeat(64)}`,
    originalImage: `sha256:${'a'.repeat(64)}`,
    name: '',
    token: '',
  };
  const tempId = 'c'.repeat(64);
  const mount = {
    Type: 'volume',
    Name: 'afiliado-shopee_postgres_data',
    Destination: '/var/lib/postgresql/data',
    RW: true,
  };
  const run = (spec: CommandSpec): CommandResult | undefined => {
    const a = spec.args,
      ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    if (spec.command !== 'docker') return;
    if (a[0] === 'compose' && a.includes('stop'))
      state.originalRunning = state.canonicalStaysRunning;
    if (a[0] === 'create') {
      state.name = a[a.indexOf('--name') + 1];
      state.token =
        a
          .find((arg) => arg.startsWith('shopee.r1d.maintenance-owner='))
          ?.split('=')[1] ?? '';
      state.image = a.at(-1) ?? '';
      state.temporaryExists = true;
      return ok(tempId);
    }
    if (a[0] === 'start') {
      state.temporaryRunning = true;
      return ok();
    }
    if (a[0] === 'stop') {
      state.temporaryRunning = false;
      return ok();
    }
    if (a[0] === 'rm') {
      state.temporaryExists = false;
      return ok();
    }
    if (a[0] === 'inspect' && a.includes('--type')) {
      const isTemp = a.at(-1) === tempId;
      return ok(
        JSON.stringify([
          {
            Id: isTemp ? tempId : a.at(-1),
            Name: isTemp ? `/${state.name}` : '/canonical',
            Image: isTemp ? state.image : state.originalImage,
            Config: {
              Labels: isTemp
                ? { 'shopee.r1d.maintenance-owner': state.token }
                : {
                    'com.docker.compose.project': 'afiliado-shopee',
                    'com.docker.compose.service': 'postgres',
                  },
            },
            State: {
              Running: isTemp ? state.temporaryRunning : state.originalRunning,
              Health: { Status: 'healthy' },
            },
            HostConfig: { RestartPolicy: { Name: 'no' } },
            Mounts: [mount],
            NetworkSettings: {
              Ports: {
                '5432/tcp': [
                  { HostIp: state.host, HostPort: String(state.port) },
                ],
              },
            },
          },
        ]),
      );
    }
    if (a[0] === 'ps' && a.includes('-aq')) {
      if (a.some((arg) => arg.startsWith('name=')))
        return ok(state.temporaryExists ? tempId : '');
      return ok(
        [
          'aaaaaaaaaaaa',
          ...(state.concurrentMount ? ['d'.repeat(64)] : []),
          ...(state.temporaryExists ? [tempId] : []),
        ].join('\n'),
      );
    }
  };
  return { state, run };
};
