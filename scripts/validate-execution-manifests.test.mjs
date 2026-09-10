import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { manifestFileNames, validateExecutionManifestRoot } from './validate-execution-manifests.mjs';

const runId = 'manifest-validator-test';
const common = (extra = {}) => ({ schemaVersion: 2, runId, createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z', status: 'PASSED', evidenceIds: [], ...extra });
const run = () => common({ mission: 'test', scope: 'test', owner: 'owner', branch: 'branch', head: 'a'.repeat(40), authorizedActions: [], prohibitedActions: [], findingIds: [], gateIds: [], supervisor: 's', singleMutator: 't', reviewerA: 'sol', reviewerB: null, finalAdversarial: null, candidateHead: 'a'.repeat(40), candidateTree: 'b'.repeat(40), candidateFrozen: true, reviewAHead: null, reviewATree: null, reviewAVerdict: 'PENDING_EXTERNAL', reviewBHead: null, reviewBTree: null, reviewBVerdict: 'NOT_RUN', adversarialHead: null, adversarialTree: null, adversarialVerdict: 'NOT_RUN', solReconciliationHead: null, solReconciliationTree: null, solReconciliationVerdict: 'NOT_RUN', mutationsAfterFreeze: false, invalidatedEvidenceIds: [] });
const documentSet = () => ({
  'RUN_MANIFEST.json': run(),
  'BASELINE.json': common({ repository: 'repo', origin: 'origin', expectedOriginMain: 'a', observedHead: 'a', branch: 'branch', ahead: 0, behind: 0, worktreeClean: true, environmentClass: 'TEST' }),
  'ENVIRONMENT.json': common({ os: 'test', runtimeVersions: {}, timezone: 'UTC', profile: 'test', envPresence: {}, ports: [], services: [], secretsPrinted: false }),
  'FINDINGS.json': common({ findings: [] }),
  'GATES.json': common({ gates: [{ gateId: 'R8-001', status: 'PASS', evidenceIds: ['E-1'] }] }),
  'EVIDENCE_INDEX.json': common({ entries: [{ evidenceId: 'E-1', type: 'command', capturedAt: '2026-09-09T00:00:00.000Z', actor: 'test', head: 'a'.repeat(40), commandOrSource: 'test', exitCode: 0, result: 'PASS', artifactPath: 'artifact.txt', stdoutSha256: 'a'.repeat(64), stderrSha256: 'b'.repeat(64) }] }),
  'EXTERNAL_EFFECTS.json': common({ effects: Object.fromEntries(['Shopee', 'OpenAI', 'Evolution', 'WhatsAppSEND', 'OperationalPostgresWrites', 'OperationalRedisWrites', 'SchedulerChanges', 'DockerVolumeChanges', 'SecretsChanges', 'PaidCost'].map((name) => [name, { count: 'UNKNOWN', status: 'UNKNOWN', evidenceIds: [] }])) }),
  'MONTHLY_COST_LEDGER.json': common({ month: '2026-09', currency: 'BRL', entries: [], total: 0, budget: 0 }),
  'CHANGE_MANIFEST.json': common({ filesChanged: [], filesAdded: [], filesDeleted: [], componentsTouched: [], schemaChanged: false, migrationAdded: false, apiContractChanged: false, schedulerChanged: false, sendBoundaryChanged: false, documentationChanged: false, scopeDeviations: [] }),
  'GIT_MANIFEST.json': common({ originMainAtStart: 'a', originMainAtEnd: 'a', branch: 'branch', baseSha: 'a', headAtStart: 'a', headSha: 'a', tree: 'b', ahead: 1, behind: 0, commit: 'a', remoteHead: 'a', worktreeClean: true, prCreated: false, prNumber: null, mergePerformed: false, mergeCommit: null }),
  'FINAL_MANIFEST.json': common({ statusFinal: 'READY_FOR_GITHUB_REVIEW', decision: 'SHIP', decisionClass: 'normal', candidateHead: 'a'.repeat(40), candidateTree: 'b'.repeat(40), candidateFrozen: true, p0: 0, p1: 0, p2: 0, r1ReadyOnMain: false, dailyUseReady: false, prCreated: false, mergePerformed: false, nextAction: 'review' }),
});
const handoff = '# RUN_ID\n\n# STATUS_FINAL\n\n# DECISION\n\n# BASELINE\n\n# FINDINGS\n\n# GATES\n\n# EFFECTS\n\n# RECOVERY\n\n# BLOCKERS\n\n# NEXT\n\n# CANDIDATE_FREEZE\n\n# REVIEWS\n\n# FILES\n\nNo secrets are included.\n';
async function fixture(mutate) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'manifest-validator-'));
  const documents = documentSet();
  mutate?.(documents);
  await Promise.all(Object.entries(documents).map(([name, value]) => writeFile(path.join(root, name), JSON.stringify(value))));
  await writeFile(path.join(root, 'HANDOFF_MANIFEST.md'), handoff);
  return root;
}
test('accepts a canonical 12-file schemaVersion 2 manifest root', async () => {
  const root = await fixture();
  try { assert.equal((await validateExecutionManifestRoot(root)).valid, true); } finally { await rm(root, { recursive: true, force: true }); }
});
for (const [label, mutate] of [
  ['invented final status', (d) => { d['FINAL_MANIFEST.json'].statusFinal = 'PENDING_REVIEW'; }],
  ['invented decision', (d) => { d['FINAL_MANIFEST.json'].decision = 'WAIT'; }],
  ['missing required field', (d) => { delete d['GIT_MANIFEST.json'].headSha; }],
  ['alias instead of canonical field', (d) => { d['GIT_MANIFEST.json'].head = d['GIT_MANIFEST.json'].headSha; delete d['GIT_MANIFEST.json'].headSha; }],
  ['incoherent review identity', (d) => { d['RUN_MANIFEST.json'].reviewAHead = 'a'.repeat(40); }],
]) test(`rejects ${label}`, async () => {
  const root = await fixture(mutate);
  try { assert.equal((await validateExecutionManifestRoot(root)).valid, false); } finally { await rm(root, { recursive: true, force: true }); }
});
test('rejects a missing, extra, or malformed handoff manifest file', async () => {
  const root = await fixture();
  try {
    await rm(path.join(root, 'FINDINGS.json'));
    assert.equal((await validateExecutionManifestRoot(root)).valid, false);
  } finally { await rm(root, { recursive: true, force: true }); }
  const extra = await fixture();
  try {
    await writeFile(path.join(extra, 'EXTRA.json'), '{}');
    await writeFile(path.join(extra, 'HANDOFF_MANIFEST.md'), '# RUN_ID\nNo secrets.\n');
    assert.equal((await validateExecutionManifestRoot(extra)).valid, false);
  } finally { await rm(extra, { recursive: true, force: true }); }
});
