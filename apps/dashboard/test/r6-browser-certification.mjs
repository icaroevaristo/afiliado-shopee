import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const dashboardRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(dashboardRoot, '..', '..');
const apiRequire = createRequire(resolve(repositoryRoot, 'apps/api/package.json'));
const playwright = await import(
  pathToFileURL(apiRequire.resolve('playwright-core')).href
);
const chromium = playwright.chromium ?? playwright.default.chromium;
const nextBin = require.resolve('next/dist/bin/next');
const chromeCandidates = [
  process.env.R6_CHROME_EXECUTABLE,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const delay = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const git = (args) => {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert(result.status === 0, `git ${args.join(' ')} failed`);
  return result.stdout.trim();
};

const baseInstances = () =>
  ['A', 'B', 'C', 'D'].map((name) => ({
    name,
    active: true,
    paused: false,
    health: 'UNKNOWN',
    assignedGroupCount: name === 'D' ? 0 : 1,
    lastSendAt: null,
    nextSendAt: null,
    blockers: [],
    updatedAt: '2026-09-09T12:00:00.000Z',
  }));

const createOverview = (assignments = ['A', 'B', 'C']) => ({
  generatedAt: '2026-09-09T12:00:00.000Z',
  automation: {
    paused: true,
    allowedStartTime: '08:00',
    allowedEndTime: '22:00',
    timezone: 'America/Sao_Paulo',
    minimumIntervalMinutes: 15,
    staggerMinutes: 5,
    dailyGlobalLimit: 10,
    dailyGroupLimit: 5,
    dailyGlobalLimitOverride: null,
    dailyGroupLimitOverride: null,
    dailyShopeeHttpLimit: 10,
    dailyOpenAiGenerationLimit: 10,
    dailyShopeeHttpLimitOverride: null,
    dailyOpenAiGenerationLimitOverride: null,
    providerUsage: {
      status: 'UNKNOWN',
      source: 'PROVIDER_USAGE',
      observedAt: null,
      usage: null,
    },
    hardCaps: { maxMessagesPerRun: 1 },
    scheduleRevision: 5,
    updatedAt: '2026-09-09T12:00:00.000Z',
  },
  nextSendAt: null,
  lastSendAt: null,
  blockers: [],
  queues: {},
  activeExecutions: 0,
  activeReservations: 0,
  ambiguity: 0,
  investigationRequired: 0,
  pendingDispatches: 0,
  pendingOutboxes: 0,
  scheduler: null,
  instances: baseInstances(),
  groups: [
    {
      id: 'group-x',
      name: 'Grupo X',
      active: true,
      paused: false,
      available: true,
      fingerprint: 'grp_xxxxxxxxxxxx',
      sourceInstanceName: 'A',
      assignedInstanceName: assignments[0] ?? null,
      assignedInstanceNames: assignments,
      assignmentRevision: 7,
      upcomingAssignments: assignments
        .slice(0, 3)
        .map((instanceName, index) => ({
          scheduledFor: `2026-09-09T1${3 + index}:00:00.000Z`,
          instanceName,
        })),
      campaign: null,
      niche: null,
      lastSendAt: null,
      nextSendAt: null,
      blockers: [],
      memberCount: 3,
      ownerIsParticipant: true,
      discoveredAt: null,
      lastSyncedAt: '2026-09-09T11:00:00.000Z',
      updatedAt: '2026-09-09T12:00:00.000Z',
    },
  ],
  campaigns: [],
});

const json = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const listen = (server) =>
  new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => resolvePromise(server.address().port));
  });

const freePort = async () => {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
};

const waitForDashboard = async (url, childOutput) => {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    if (childOutput.exited)
      throw new Error(`Dashboard exited early: ${childOutput.tail}`);
    await delay(250);
  }
  throw new Error(`Dashboard did not become ready: ${childOutput.tail}`);
};

const sanitizeRequest = (entry) => ({
  method: entry.method,
  path: entry.path,
  status: entry.status,
  errorCode: entry.errorCode ?? null,
});

const compactText = (value) => value.replace(/\s+/g, ' ').trim();

const run = async () => {
  const head = git(['rev-parse', 'HEAD']);
  const tree = git(['show', '-s', '--format=%T', 'HEAD']);
  const testToken = randomBytes(24).toString('hex');
  let overview = createOverview();
  let lifecycleActive = false;
  const getBehaviors = [];
  const upstreamRequests = [];
  let delayedGets = 0;

  const api = createServer(async (request, response) => {
    const parsed = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && parsed.pathname === '/health') {
      json(response, 200, { status: 'ok', service: 'api' });
      return;
    }
    const authorized = request.headers.authorization === `Bearer ${testToken}`;
    if (!authorized) {
      json(response, 401, { error: 'UNAUTHORIZED', message: 'Unauthorized' });
      return;
    }
    if (request.method === 'GET' && parsed.pathname === '/operational-admin') {
      const behavior = getBehaviors.shift() ?? {};
      const captured = structuredClone(overview);
      if (behavior.delayMs) {
        delayedGets += 1;
        await delay(behavior.delayMs);
        delayedGets -= 1;
      }
      upstreamRequests.push({
        method: 'GET',
        path: parsed.pathname,
        status: behavior.fail ? 503 : 200,
      });
      if (behavior.fail) {
        json(response, 503, {
          error: 'OPERATIONAL_STATUS_UNAVAILABLE',
          message: 'Snapshot unavailable',
        });
      } else {
        json(response, 200, captured);
      }
      return;
    }
    if (
      request.method === 'PATCH' &&
      parsed.pathname === '/whatsapp/groups/group-x/admin'
    ) {
      const body = await readBody(request);
      if (lifecycleActive) {
        upstreamRequests.push({
          method: 'PATCH',
          path: parsed.pathname,
          status: 409,
          errorCode: 'OPERATIONAL_ASSIGNMENT_LIFECYCLE_ACTIVE',
        });
        json(response, 409, {
          error: 'OPERATIONAL_ASSIGNMENT_LIFECYCLE_ACTIVE',
          message: 'Lifecycle active',
        });
        return;
      }
      const group = overview.groups[0];
      if (body.expectedUpdatedAt !== group.updatedAt) {
        upstreamRequests.push({
          method: 'PATCH',
          path: parsed.pathname,
          status: 409,
          errorCode: 'OPERATIONAL_CAS_CONFLICT',
        });
        json(response, 409, {
          error: 'OPERATIONAL_CAS_CONFLICT',
          message: 'CAS conflict',
        });
        return;
      }
      assert(
        body.confirmation === 'CONFIRMAR_REATRIBUICAO_GRUPO',
        'missing confirmation',
      );
      assert(
        Array.isArray(body.assignedInstanceNames),
        'ordered payload missing',
      );
      assert(
        !('assignedInstanceName' in body),
        'legacy and ordered payload mixed',
      );
      const revision = group.assignmentRevision + 1;
      const updatedAt = `2026-09-09T12:${String(revision).padStart(2, '0')}:00.000Z`;
      overview = {
        ...overview,
        generatedAt: updatedAt,
        groups: [
          {
            ...group,
            assignedInstanceName: body.assignedInstanceNames[0] ?? null,
            assignedInstanceNames: [...body.assignedInstanceNames],
            assignmentRevision: revision,
            updatedAt,
          },
        ],
      };
      upstreamRequests.push({
        method: 'PATCH',
        path: parsed.pathname,
        status: 200,
      });
      json(response, 200, overview.groups[0]);
      return;
    }
    json(response, 404, { error: 'NOT_FOUND', message: 'Not found' });
  });

  const apiPort = await listen(api);
  const dashboardPort = await freePort();
  const dashboardUrl = `http://127.0.0.1:${dashboardPort}/whatsapp`;
  const childOutput = { tail: '', exited: false };
  const dashboard = spawn(
    process.execPath,
    [nextBin, 'dev', '-H', '127.0.0.1', '-p', String(dashboardPort)],
    {
      cwd: dashboardRoot,
      env: {
        ...process.env,
        DASHBOARD_API_URL: `http://127.0.0.1:${apiPort}`,
        LOCAL_API_AUTH_TOKEN: testToken,
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const appendChildOutput = (chunk) => {
    childOutput.tail = `${childOutput.tail}${chunk.toString('utf8')}`.slice(
      -4000,
    );
  };
  dashboard.stdout.on('data', appendChildOutput);
  dashboard.stderr.on('data', appendChildOutput);
  dashboard.once('exit', () => {
    childOutput.exited = true;
  });

  const externalNetworkAttempts = [];
  const browserAuthorizationHeaders = [];
  const scenarios = [];
  let browser;

  const newContext = async (viewport = { width: 1280, height: 900 }) => {
    const context = await browser.newContext({ viewport });
    await context.route('**/*', async (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host !== '127.0.0.1' && host !== 'localhost') {
        externalNetworkAttempts.push(route.request().url());
        await route.abort('blockedbyclient');
        return;
      }
      const headers = route.request().headers();
      if (headers.authorization)
        browserAuthorizationHeaders.push(route.request().url());
      await route.continue();
    });
    return context;
  };

  const record = async (scenarioId, viewport, action) => {
    const startedAt = new Date().toISOString();
    const requestStart = upstreamRequests.length;
    const context = await newContext(viewport);
    const page = await context.newPage();
    const dialogs = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.accept();
    });
    let details;
    try {
      await page.goto(dashboardUrl, { waitUntil: 'networkidle' });
      const domStateBefore = compactText(
        (await groupCard(page).textContent()) ?? '',
      );
      const serverStateBefore = structuredClone(overview.groups[0]);
      details = await action(page);
      const browserSecrets = await page.evaluate(() => ({
        bodyContainsBearer:
          document.body.textContent?.includes('Bearer ') ?? false,
        localStorageKeys: Object.keys(localStorage),
        sessionStorageKeys: Object.keys(sessionStorage),
        urlHasCredential: /token|authorization|bearer/i.test(location.href),
      }));
      assert(
        !browserSecrets.bodyContainsBearer,
        `${scenarioId}: bearer leaked to DOM`,
      );
      assert(
        browserSecrets.localStorageKeys.length === 0,
        `${scenarioId}: localStorage used`,
      );
      assert(
        browserSecrets.sessionStorageKeys.length === 0,
        `${scenarioId}: sessionStorage used`,
      );
      assert(
        !browserSecrets.urlHasCredential,
        `${scenarioId}: credential-like URL`,
      );
      const requests = upstreamRequests
        .slice(requestStart)
        .map(sanitizeRequest);
      scenarios.push({
        scenarioId,
        head,
        tree,
        browser: 'system-chromium',
        viewport,
        startedAt,
        finishedAt: new Date().toISOString(),
        result: 'PASS',
        ...details,
        dialogs,
        dialogAccepted: dialogs.length > 0 ? true : null,
        domStateBefore,
        domStateAfter: compactText((await groupCard(page).textContent()) ?? ''),
        serverStateBefore,
        serverStateAfter: structuredClone(overview.groups[0]),
        requestCount: requests.length,
        requests,
      });
    } catch (error) {
      const body =
        (await page
          .locator('body')
          .textContent()
          .catch(() => '')) ?? '';
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nPAGE=${body.slice(0, 2000)}\nNEXT=${childOutput.tail}`,
      );
    } finally {
      await context.close();
    }
  };

  const groupCard = (page) =>
    page.locator('.ops-group-card').filter({ hasText: 'Grupo X' });
  const edit = async (page) =>
    groupCard(page).getByRole('button', { name: 'Editar' }).click();
  const save = async (page) =>
    groupCard(page)
      .getByRole('button', { name: /Salvar ordem|Trocar WhatsApp/ })
      .click();

  try {
    await waitForDashboard(dashboardUrl, childOutput);
    const executablePath = chromeCandidates.find((candidate) => {
      try {
        return Boolean(require('node:fs').statSync(candidate));
      } catch {
        return false;
      }
    });
    assert(executablePath, 'No local Chromium executable found');
    browser = await chromium.launch({ executablePath, headless: true });

    overview = createOverview();
    await record(
      'BROWSER-R6-01',
      { width: 1280, height: 900 },
      async (page) => {
        await page.getByText('Ordem persistida: A → B → C').waitFor();
        assert(
          (await groupCard(page).textContent()).includes(
            'Revisão do roteamento7',
          ),
          'revision hidden',
        );
        return {
          actions: ['render persisted N=3'],
          domStateAfter: 'persisted A→B→C; revision 7',
        };
      },
    );

    overview = createOverview();
    await record(
      'BROWSER-R6-02',
      { width: 1280, height: 900 },
      async (page) => {
        await edit(page);
        await groupCard(page)
          .getByRole('button', { name: 'Mover B para cima' })
          .click();
        const text = await groupCard(page).textContent();
        assert(
          text.includes('Ordem persistida: A → B → C'),
          'draft replaced persisted summary',
        );
        assert(text.includes('Alterações não salvas'), 'draft not identified');
        const patchCount = upstreamRequests.filter(
          (entry) => entry.method === 'PATCH',
        ).length;
        assert(patchCount === 0, 'local reorder issued PATCH');
        await groupCard(page)
          .getByRole('button', { name: 'Fechar edição' })
          .click();
        await edit(page);
        assert(
          (await groupCard(page).textContent()).includes(
            'Igual ao estado persistido',
          ),
          'draft survived close',
        );
        return {
          actions: ['move B up without save', 'close editor', 'reopen editor'],
          domStateAfter: 'persisted A→B→C; draft reset',
        };
      },
    );

    overview = createOverview();
    await record(
      'BROWSER-R6-03',
      { width: 1280, height: 900 },
      async (page) => {
        await edit(page);
        await groupCard(page)
          .getByRole('button', { name: 'Mover B para cima' })
          .click();
        await save(page);
        await page.getByText('Grupo Grupo X atualizado.').waitFor();
        await page.getByText('Ordem persistida: B → A → C').waitFor();
        assert(
          overview.groups[0].assignmentRevision === 8,
          'revision did not advance',
        );
        return {
          actions: ['confirmed reorder A→B→C to B→A→C'],
          domStateAfter: 'persisted B→A→C; revision 8',
          serverStateAfter: overview.groups[0],
        };
      },
    );

    overview = createOverview();
    {
      const startedAt = new Date().toISOString();
      const requestStart = upstreamRequests.length;
      const contextA = await newContext();
      const contextB = await newContext();
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      const dialogs = [];
      for (const page of [pageA, pageB]) {
        page.on('dialog', async (dialog) => {
          dialogs.push(dialog.message());
          await dialog.accept();
        });
        await page.goto(dashboardUrl, { waitUntil: 'networkidle' });
      }
      const domStateBefore = compactText(
        (await groupCard(pageB).textContent()) ?? '',
      );
      const serverStateBefore = structuredClone(overview.groups[0]);
      await edit(pageA);
      await groupCard(pageA)
        .getByRole('button', { name: 'Mover B para cima' })
        .click();
      await save(pageA);
      await pageA.getByText('Ordem persistida: B → A → C').waitFor();
      await edit(pageB);
      await groupCard(pageB)
        .getByRole('button', { name: 'Mover C para cima' })
        .click();
      await groupCard(pageB)
        .getByRole('button', { name: 'Mover C para cima' })
        .click();
      await save(pageB);
      await pageB.getByText(/alterado em outro lugar/i).waitFor();
      await pageB.getByText('Ordem persistida: B → A → C').waitFor();
      const patches = upstreamRequests
        .slice(requestStart)
        .filter((entry) => entry.method === 'PATCH');
      assert(
        patches.length === 2 && patches[1].status === 409,
        'two-browser CAS contract failed',
      );
      const requests = upstreamRequests
        .slice(requestStart)
        .map(sanitizeRequest);
      scenarios.push({
        scenarioId: 'BROWSER-R6-04',
        head,
        tree,
        browser: 'system-chromium',
        viewport: { width: 1280, height: 900 },
        startedAt,
        finishedAt: new Date().toISOString(),
        result: 'PASS',
        dialogs,
        dialogAccepted: true,
        requests,
        requestCount: requests.length,
        actions: [
          'browser A saves B→A→C',
          'browser B submits stale C→A→B once',
        ],
        domStateBefore,
        domStateAfter: compactText(
          (await groupCard(pageB).textContent()) ?? '',
        ),
        serverStateBefore,
        serverStateAfter: structuredClone(overview.groups[0]),
      });
      await contextA.close();
      await contextB.close();
    }

    overview = createOverview();
    lifecycleActive = true;
    await record(
      'BROWSER-R6-05',
      { width: 1280, height: 900 },
      async (page) => {
        const lifecyclePatchesBefore = upstreamRequests.filter(
          (entry) =>
            entry.method === 'PATCH' &&
            entry.errorCode === 'OPERATIONAL_ASSIGNMENT_LIFECYCLE_ACTIVE',
        ).length;
        await edit(page);
        await groupCard(page)
          .getByRole('button', { name: 'Mover B para cima' })
          .click();
        await save(page);
        await page
          .getByText(
            'Há um envio em andamento para este grupo. Aguarde a conclusão antes de trocar o WhatsApp responsável.',
          )
          .waitFor();
        const patches = upstreamRequests.filter(
          (entry) =>
            entry.method === 'PATCH' &&
            entry.errorCode === 'OPERATIONAL_ASSIGNMENT_LIFECYCLE_ACTIVE',
        );
        assert(
          patches.length - lifecyclePatchesBefore === 1,
          'lifecycle mutation retried',
        );
        return {
          actions: ['submit reorder during active lifecycle'],
          domStateAfter: 'lifecycle 409 visible; draft not persisted',
          serverStateAfter: overview.groups[0],
        };
      },
    );
    lifecycleActive = false;

    overview = createOverview();
    await record(
      'BROWSER-R6-06',
      { width: 1280, height: 900 },
      async (page) => {
        getBehaviors.push({ delayMs: 700 });
        await page
          .getByRole('button', { name: 'Atualizar' })
          .click({ noWaitAfter: true });
        while (delayedGets === 0) await delay(10);
        await edit(page);
        await groupCard(page)
          .getByRole('button', { name: 'Mover B para cima' })
          .click();
        await save(page);
        await page.getByText('Ordem persistida: B → A → C').waitFor();
        await delay(800);
        assert(
          (await groupCard(page).textContent()).includes(
            'Ordem persistida: B → A → C',
          ),
          'stale GET overwrote new state',
        );
        return {
          actions: [
            'start delayed refresh',
            'save reorder',
            'receive old GET last',
          ],
          domStateAfter: 'latest persisted B→A→C retained',
        };
      },
    );

    overview = createOverview();
    await record(
      'BROWSER-R6-07',
      { width: 1280, height: 900 },
      async (page) => {
        await edit(page);
        await groupCard(page)
          .getByRole('button', { name: 'Mover B para cima' })
          .click();
        getBehaviors.push({ fail: true });
        await save(page);
        await page
          .getByText(/dados exibidos podem estar desatualizados/i)
          .first()
          .waitFor();
        const saveButton = groupCard(page).getByRole('button', {
          name: /Salvar ordem/,
        });
        assert(await saveButton.isDisabled(), 'stale snapshot allowed save');
        const patchesBefore = upstreamRequests.filter(
          (entry) => entry.method === 'PATCH',
        ).length;
        await page.getByRole('button', { name: 'Atualizar' }).click();
        await page.getByText('Ordem persistida: B → A → C').waitFor();
        assert(
          (await page
            .getByText(/dados exibidos podem estar desatualizados/i)
            .count()) === 0,
          'manual refresh did not clear stale state',
        );
        assert(
          !(await groupCard(page)
            .getByRole('button', { name: 'Pausar grupo' })
            .isDisabled()),
          'manual refresh did not recover mutation controls',
        );
        const patchesAfter = upstreamRequests.filter(
          (entry) => entry.method === 'PATCH',
        ).length;
        assert(
          patchesBefore === patchesAfter,
          'post-write refresh failure retried PATCH',
        );
        return {
          actions: [
            'save accepted',
            'post-write GET fails',
            'manual refresh recovers',
          ],
          domStateAfter: 'stale marked then cleared; no PATCH retry',
        };
      },
    );

    overview = createOverview();
    overview.instances = overview.instances.map((instance) =>
      instance.name === 'B' ? { ...instance, active: false } : instance,
    );
    await record(
      'BROWSER-R6-08',
      { width: 1280, height: 900 },
      async (page) => {
        await edit(page);
        const text = await groupCard(page).textContent();
        assert(
          text.includes('Ordem persistida: A → B → C'),
          'inactive assignment removed',
        );
        assert(
          text.includes('B (indisponível)'),
          'inactive assignment not identified',
        );
        return {
          actions: ['render inactive persisted B'],
          domStateAfter: 'B preserved in position 2 and marked unavailable',
        };
      },
    );

    overview = createOverview(['A']);
    await record(
      'BROWSER-R6-09',
      { width: 1280, height: 900 },
      async (page) => {
        await edit(page);
        await groupCard(page)
          .getByRole('button', { name: 'Remover A' })
          .click();
        await save(page);
        await page
          .getByText('Ordem persistida: Nenhum WhatsApp responsável')
          .waitFor();
        assert(
          overview.groups[0].assignedInstanceNames.length === 0,
          'last assignment fallback occurred',
        );
        return {
          actions: ['remove last assignment with explicit confirmation'],
          domStateAfter: 'persisted empty assignment list',
          serverStateAfter: overview.groups[0],
        };
      },
    );

    overview = createOverview();
    await record('BROWSER-R6-10', { width: 390, height: 844 }, async (page) => {
      await edit(page);
      const controls = ['Mover B para cima', 'Mover B para baixo', 'Remover B'];
      for (const name of controls)
        assert(
          await groupCard(page).getByRole('button', { name }).isVisible(),
          `${name} hidden on mobile`,
        );
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      assert(overflow <= 1, `mobile horizontal overflow: ${overflow}`);
      return {
        actions: ['open editor at 390px', 'inspect ordered controls'],
        domStateAfter: 'editor operable without horizontal overflow',
        accessibility: controls,
      };
    });

    overview = createOverview();
    await record(
      'BROWSER-R6-11',
      { width: 1366, height: 900 },
      async (page) => {
        await edit(page);
        const saveButton = groupCard(page).getByRole('button', {
          name: /Salvar ordem/,
        });
        assert(await saveButton.isVisible(), 'save hidden on desktop');
        assert(
          await page.getByRole('button', { name: 'Atualizar' }).isVisible(),
          'refresh lacks accessible name',
        );
        return {
          actions: [
            'open editor at desktop width',
            'inspect accessible controls',
          ],
          domStateAfter: 'desktop editor visible and operable',
        };
      },
    );

    assert(
      externalNetworkAttempts.length === 0,
      'external browser network attempt observed',
    );
    assert(
      browserAuthorizationHeaders.length === 0,
      'authorization header reached browser request',
    );
    assert(scenarios.length === 11, 'browser scenario count mismatch');

    const trace = {
      runId: 'R6-AUTONOMOUS-CLOSEOUT-20260909-01',
      head,
      tree,
      capturedAt: new Date().toISOString(),
      runner: 'playwright-core with installed local Chromium',
      browserVersion: await browser.version(),
      scenarios,
      assertions: {
        scenarioCount: scenarios.length,
        externalBrowserNetworkAttempts: externalNetworkAttempts.length,
        tokenInBrowserRequest: browserAuthorizationHeaders.length,
        maxPatchPerConfirmation: 1,
        automaticMutationRetry: 0,
      },
    };
    const artifactPath = resolve(
      repositoryRoot,
      process.env.R6_BROWSER_ARTIFACT_PATH ??
        '.runtime/autonomous-execution/artifacts/R6-AUTONOMOUS-CLOSEOUT-20260909-01/r6-browser-trace.json',
    );
    await mkdir(dirname(artifactPath), { recursive: true });
    const content = `${JSON.stringify(trace, null, 2)}\n`;
    await writeFile(artifactPath, content, 'utf8');
    process.stdout.write(
      `${JSON.stringify({
        result: 'PASS',
        head,
        tree,
        browser: trace.browserVersion,
        scenarioCount: scenarios.length,
        externalBrowserNetworkAttempts: 0,
        tokenInBrowserRequest: 0,
        artifactPath: artifactPath.replace(repositoryRoot, '<repo>'),
        artifactSha256: createHash('sha256').update(content).digest('hex'),
      })}\n`,
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolvePromise) => api.close(resolvePromise));
    if (dashboard.pid) {
      spawnSync('taskkill', ['/PID', String(dashboard.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    }
  }
};

run().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
