import { randomUUID } from 'node:crypto';
import { LocalSystemError, type SystemDependencies } from './types';

const fail = (code: string): never => {
  throw new LocalSystemError(
    'Isolamento PostgreSQL nao comprovado; HUMAN_REQUIRED',
    code,
  );
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const object = (value: unknown) =>
  record(value) ? value : fail('SYSTEM_MAINTENANCE_DOCKER_IDENTITY');
const list = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : fail('SYSTEM_MAINTENANCE_DOCKER_IDENTITY');
const string = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : fail('SYSTEM_MAINTENANCE_DOCKER_IDENTITY');
const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return fail('SYSTEM_MAINTENANCE_DOCKER_IDENTITY');
  }
};

/** Owns only the temporary container. The original container and volume are never removed. */
export class MaintenancePostgres {
  private readonly token = randomUUID();
  private readonly name: string;
  private id: string | undefined;
  private creationAttempted = false;
  private volumeIdentity = '';
  private volumes: string[] = [];
  private image = '';
  constructor(
    private readonly root: string,
    private readonly deps: SystemDependencies,
    private readonly env: NodeJS.ProcessEnv,
    private readonly project: string,
    private readonly canonicalId: string,
    private readonly volume: string,
    private readonly canonicalPort: number,
  ) {
    this.name = `${project}-r1d-maintenance-${this.token}`;
  }

  private async docker(args: string[]) {
    const result = await this.deps.run({
      command: 'docker',
      args,
      cwd: this.root,
      env: this.env,
    });
    if (result.code !== 0) fail('SYSTEM_MAINTENANCE_DOCKER_FAILED');
    return result.stdout;
  }
  private async inspect(id: string) {
    const items = list(
      parse(await this.docker(['inspect', '--type', 'container', id])),
    );
    if (items.length !== 1) fail('SYSTEM_MAINTENANCE_DOCKER_IDENTITY');
    return object(items[0]);
  }
  private assertMount(container: Record<string, unknown>) {
    const mounts = list(container.Mounts).map(object);
    if (
      mounts.length !== 1 ||
      mounts[0].Type !== 'volume' ||
      mounts[0].Name !== this.volume ||
      mounts[0].Destination !== '/var/lib/postgresql/data' ||
      mounts[0].RW !== true
    )
      fail('SYSTEM_MAINTENANCE_VOLUME_GUARD');
  }
  private async readVolumeIdentity() {
    const entries = list(
      parse(await this.docker(['volume', 'inspect', this.volume])),
    );
    if (entries.length !== 1) fail('SYSTEM_MAINTENANCE_VOLUME_GUARD');
    const v = object(entries[0]),
      labels = object(v.Labels);
    if (
      v.Name !== this.volume ||
      labels['com.docker.compose.project'] !== this.project ||
      labels['com.docker.compose.volume'] !== 'postgres_data' ||
      v.Driver !== 'local' ||
      v.Scope !== 'local'
    )
      fail('SYSTEM_MAINTENANCE_VOLUME_GUARD');
    return JSON.stringify([
      v.Name,
      v.Driver,
      v.Scope,
      v.CreatedAt,
      v.Mountpoint,
      Object.entries(labels).sort(),
    ]);
  }
  private async postgresVolumes() {
    return (await this.docker(['volume', 'ls', '--format', '{{.Name}}']))
      .split(/\r?\n/)
      .filter((name) => name.includes('postgres_data'))
      .sort();
  }
  async prepare() {
    const original = await this.inspect(this.canonicalId);
    if (
      original.Id !== this.canonicalId ||
      object(original.State).Running !== true
    )
      fail('SYSTEM_MAINTENANCE_POSTGRES_GUARD');
    const labels = object(object(original.Config).Labels);
    if (
      labels['com.docker.compose.project'] !== this.project ||
      labels['com.docker.compose.service'] !== 'postgres'
    )
      fail('SYSTEM_MAINTENANCE_DOCKER_IDENTITY');
    this.assertMount(original);
    this.image = string(original.Image);
    if (!/^sha256:[a-f0-9]{64}$/.test(this.image))
      fail('SYSTEM_MAINTENANCE_IMAGE_GUARD');
    this.volumeIdentity = await this.readVolumeIdentity();
    this.volumes = await this.postgresVolumes();
  }
  async assertOriginalStopped() {
    const original = await this.inspect(this.canonicalId);
    if (
      original.Id !== this.canonicalId ||
      object(original.State).Running !== false ||
      original.Image !== this.image
    )
      fail('SYSTEM_MAINTENANCE_POSTGRES_STILL_RUNNING');
    this.assertMount(original);
    for (const port of new Set([5432, this.canonicalPort])) {
      if (await this.deps.getPortOccupant(port))
        fail('SYSTEM_MAINTENANCE_ORIGINAL_PORT_BUSY');
    }
  }
  private async assertExclusiveVolume() {
    const ids = (
      await this.docker([
        'ps',
        '-aq',
        '--no-trunc',
        '--filter',
        `volume=${this.volume}`,
      ])
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    for (const id of ids) {
      if (id === this.canonicalId || id === this.id) continue;
      const candidate = await this.inspect(id);
      if (
        list(candidate.Mounts)
          .map(object)
          .some((m) => m.Name === this.volume && m.RW !== false)
      )
        fail('SYSTEM_MAINTENANCE_VOLUME_CONCURRENT_MOUNT');
    }
    if ((await this.readVolumeIdentity()) !== this.volumeIdentity)
      fail('SYSTEM_MAINTENANCE_VOLUME_GUARD');
  }
  private assertOwned(container: Record<string, unknown>) {
    if (
      container.Name !== `/${this.name}` ||
      object(object(container.Config).Labels)[
        'shopee.r1d.maintenance-owner'
      ] !== this.token ||
      container.Image !== this.image ||
      (this.id !== undefined && container.Id !== this.id)
    )
      fail('SYSTEM_MAINTENANCE_DOCKER_IDENTITY');
    this.assertMount(container);
  }
  async start(databaseUrl: string) {
    await this.assertOriginalStopped();
    await this.assertExclusiveVolume();
    this.creationAttempted = true;
    // No credential is passed in argv, Docker environment, logs or persisted state.
    const created = await this.docker([
      'create',
      '--pull=never',
      '--name',
      this.name,
      '--restart=no',
      '--label',
      `shopee.r1d.maintenance-owner=${this.token}`,
      '--label',
      `shopee.r1d.project=${this.project}`,
      '--mount',
      `type=volume,src=${this.volume},dst=/var/lib/postgresql/data`,
      '--publish',
      '127.0.0.1::5432',
      '--health-cmd',
      'pg_isready -U postgres -d shopee_auto_affiliate_ai',
      '--health-interval',
      '1s',
      '--health-timeout',
      '3s',
      '--health-retries',
      '30',
      this.image,
    ]);
    this.id = created.trim();
    if (!/^[a-f0-9]{64}$/.test(this.id))
      fail('SYSTEM_MAINTENANCE_DOCKER_IDENTITY');
    this.assertOwned(await this.inspect(this.id));
    await this.assertOriginalStopped();
    await this.assertExclusiveVolume();
    await this.docker(['start', this.id]);
    for (let attempt = 0; attempt < 60; attempt++) {
      const current = await this.inspect(this.id);
      this.assertOwned(current);
      const state = object(current.State);
      if (state.Running !== true) fail('SYSTEM_MAINTENANCE_POSTGRES_GUARD');
      if (object(state.Health).Status === 'healthy') {
        const host = object(current.HostConfig);
        if (object(host.RestartPolicy).Name !== 'no')
          fail('SYSTEM_MAINTENANCE_DOCKER_IDENTITY');
        const ports = object(object(current.NetworkSettings).Ports);
        const bindings = list(ports['5432/tcp']).map(object);
        if (
          Object.keys(ports).length !== 1 ||
          bindings.length !== 1 ||
          bindings[0].HostIp !== '127.0.0.1'
        )
          fail('SYSTEM_MAINTENANCE_PORT_GUARD');
        const port = Number(bindings[0].HostPort);
        if (
          !Number.isInteger(port) ||
          port < 1024 ||
          port > 65535 ||
          port === 5432 ||
          port === this.canonicalPort
        )
          fail('SYSTEM_MAINTENANCE_PORT_GUARD');
        const url = new URL(databaseUrl);
        url.hostname = '127.0.0.1';
        url.port = String(port);
        return {
          databaseUrl: url.toString(),
          host: '127.0.0.1',
          port,
          image: this.image,
        };
      }
      // Readiness only; isolation does not depend on activity snapshots or timing.
      await this.deps.sleep(500);
    }
    return fail('SYSTEM_MAINTENANCE_POSTGRES_GUARD');
  }
  async verify() {
    const id = this.id;
    if (!id) return fail('SYSTEM_MAINTENANCE_DOCKER_IDENTITY');
    const current = await this.inspect(id);
    this.assertOwned(current);
    if (object(current.State).Running !== true)
      fail('SYSTEM_MAINTENANCE_POSTGRES_GUARD');
    await this.assertOriginalStopped();
    await this.assertExclusiveVolume();
  }
  async cleanup() {
    if (!this.creationAttempted) return;
    const ids = (
      await this.docker([
        'ps',
        '-aq',
        '--no-trunc',
        '--filter',
        `name=^/${this.name}$`,
      ])
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (ids.length > 1) fail('SYSTEM_MAINTENANCE_CLEANUP_FAILED');
    if (ids.length === 1) {
      const current = await this.inspect(ids[0]);
      this.assertOwned(current);
      if (object(current.State).Running === true)
        await this.docker(['stop', ids[0]]);
      if (object((await this.inspect(ids[0])).State).Running !== false)
        fail('SYSTEM_MAINTENANCE_CLEANUP_FAILED');
      await this.docker(['rm', ids[0]]);
    }
    if (
      (
        await this.docker([
          'ps',
          '-aq',
          '--no-trunc',
          '--filter',
          `name=^/${this.name}$`,
        ])
      ).trim()
    )
      fail('SYSTEM_MAINTENANCE_CLEANUP_FAILED');
    await this.assertOriginalStopped();
    if (
      (await this.readVolumeIdentity()) !== this.volumeIdentity ||
      JSON.stringify(await this.postgresVolumes()) !==
        JSON.stringify(this.volumes)
    )
      fail('SYSTEM_MAINTENANCE_VOLUME_GUARD');
  }
}
