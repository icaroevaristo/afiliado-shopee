import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const manifestFileNames = Object.freeze([
  'RUN_MANIFEST.json',
  'BASELINE.json',
  'ENVIRONMENT.json',
  'FINDINGS.json',
  'GATES.json',
  'EVIDENCE_INDEX.json',
  'EXTERNAL_EFFECTS.json',
  'MONTHLY_COST_LEDGER.json',
  'CHANGE_MANIFEST.json',
  'GIT_MANIFEST.json',
  'FINAL_MANIFEST.json',
  'HANDOFF_MANIFEST.md',
]);

const commonStatuses = new Set([
  'PLANNED',
  'PREFLIGHTED',
  'RUNNING',
  'QUIESCING',
  'RESTORING',
  'PASSED',
  'FAILED',
  'BLOCKED',
  'HUMAN_REQUIRED',
  'CLOSED',
]);
const finalStatuses = new Set([
  'READY_FOR_GITHUB_REVIEW',
  'DONE_NO_GIT_CHANGE',
  'BLOCKED',
  'HUMAN_REQUIRED',
  'FAILED_VALIDATION',
]);
const finalDecisions = new Set(['SHIP', 'FIX_FIRST', 'BLOCKED', 'HUMAN_REQUIRED']);
const externalEffectCategories = Object.freeze([
  'Shopee',
  'OpenAI',
  'Evolution',
  'WhatsAppSEND',
  'OperationalPostgresWrites',
  'OperationalRedisWrites',
  'SchedulerChanges',
  'DockerVolumeChanges',
  'SecretsChanges',
  'PaidCost',
]);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const assert = (condition, message, errors) => {
  if (!condition) errors.push(message);
};
const hasKeys = (value, keys, label, errors) => {
  assert(isObject(value), `${label} must be an object`, errors);
  if (!isObject(value)) return;
  for (const key of keys) assert(Object.hasOwn(value, key), `${label}.${key} is required`, errors);
};
const common = (value, label, runId, errors) => {
  hasKeys(value, ['schemaVersion', 'runId', 'createdAt', 'updatedAt', 'status', 'evidenceIds'], label, errors);
  if (!isObject(value)) return;
  assert(value.schemaVersion === 2, `${label}.schemaVersion must equal 2`, errors);
  assert(value.runId === runId, `${label}.runId must match RUN_MANIFEST.runId`, errors);
  assert(nonEmptyString(value.createdAt), `${label}.createdAt must be nonempty`, errors);
  assert(nonEmptyString(value.updatedAt), `${label}.updatedAt must be nonempty`, errors);
  assert(commonStatuses.has(value.status), `${label}.status is not canonical`, errors);
  assert(Array.isArray(value.evidenceIds), `${label}.evidenceIds must be an array`, errors);
};
const pair = (value, left, right, label, errors) => {
  const first = value[left];
  const second = value[right];
  assert(
    (first === null && second === null) || (nonEmptyString(first) && nonEmptyString(second)),
    `${label}.${left}/${right} must be both null or both nonempty strings`,
    errors,
  );
};

export async function validateExecutionManifestRoot(manifestRoot) {
  const errors = [];
  const entries = await readdir(manifestRoot, { withFileTypes: true });
  const observed = entries.map((entry) => entry.name).sort();
  const expected = [...manifestFileNames].sort();
  assert(entries.every((entry) => entry.isFile()), 'manifest root may contain files only', errors);
  assert(JSON.stringify(observed) === JSON.stringify(expected), 'manifest root must contain exactly the canonical 12 files', errors);

  const documents = {};
  for (const fileName of manifestFileNames.filter((name) => name.endsWith('.json'))) {
    try {
      documents[fileName] = JSON.parse(await readFile(path.join(manifestRoot, fileName), 'utf8'));
    } catch (error) {
      errors.push(`${fileName} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const run = documents['RUN_MANIFEST.json'];
  const runId = isObject(run) && nonEmptyString(run.runId) ? run.runId : undefined;
  hasKeys(run, [
    'schemaVersion', 'runId', 'createdAt', 'updatedAt', 'mission', 'scope', 'owner', 'branch', 'head', 'status',
    'authorizedActions', 'prohibitedActions', 'findingIds', 'gateIds', 'evidenceIds', 'supervisor', 'singleMutator',
    'reviewerA', 'reviewerB', 'finalAdversarial', 'candidateHead', 'candidateTree', 'candidateFrozen', 'reviewAHead',
    'reviewATree', 'reviewAVerdict', 'reviewBHead', 'reviewBTree', 'reviewBVerdict', 'adversarialHead',
    'adversarialTree', 'adversarialVerdict', 'solReconciliationHead', 'solReconciliationTree',
    'solReconciliationVerdict', 'mutationsAfterFreeze', 'invalidatedEvidenceIds',
  ], 'RUN_MANIFEST', errors);
  if (isObject(run)) {
    assert(run.schemaVersion === 2, 'RUN_MANIFEST.schemaVersion must equal 2', errors);
    assert(nonEmptyString(runId), 'RUN_MANIFEST.runId must be nonempty', errors);
    assert(commonStatuses.has(run.status), 'RUN_MANIFEST.status is not canonical', errors);
    for (const [left, right] of [
      ['candidateHead', 'candidateTree'], ['reviewAHead', 'reviewATree'], ['reviewBHead', 'reviewBTree'],
      ['adversarialHead', 'adversarialTree'], ['solReconciliationHead', 'solReconciliationTree'],
    ]) pair(run, left, right, 'RUN_MANIFEST', errors);
    assert(typeof run.candidateFrozen === 'boolean', 'RUN_MANIFEST.candidateFrozen must be boolean', errors);
    assert(Array.isArray(run.invalidatedEvidenceIds), 'RUN_MANIFEST.invalidatedEvidenceIds must be an array', errors);
  }

  const simpleRequirements = {
    'BASELINE.json': ['repository', 'origin', 'expectedOriginMain', 'observedHead', 'branch', 'ahead', 'behind', 'worktreeClean', 'environmentClass'],
    'ENVIRONMENT.json': ['os', 'runtimeVersions', 'timezone', 'profile', 'envPresence', 'ports', 'services', 'secretsPrinted'],
    'FINDINGS.json': ['findings'],
    'GATES.json': ['gates'],
    'EVIDENCE_INDEX.json': ['entries'],
    'MONTHLY_COST_LEDGER.json': ['month', 'currency', 'entries', 'total', 'budget', 'status'],
    'CHANGE_MANIFEST.json': ['filesChanged', 'filesAdded', 'filesDeleted', 'componentsTouched', 'schemaChanged', 'migrationAdded', 'apiContractChanged', 'schedulerChanged', 'sendBoundaryChanged', 'documentationChanged', 'scopeDeviations'],
    'GIT_MANIFEST.json': ['originMainAtStart', 'originMainAtEnd', 'branch', 'baseSha', 'headAtStart', 'headSha', 'tree', 'ahead', 'behind', 'commit', 'remoteHead', 'worktreeClean', 'prCreated', 'prNumber', 'mergePerformed', 'mergeCommit'],
    'FINAL_MANIFEST.json': ['statusFinal', 'decision', 'decisionClass', 'candidateHead', 'candidateTree', 'candidateFrozen', 'p0', 'p1', 'p2', 'r1ReadyOnMain', 'dailyUseReady', 'prCreated', 'mergePerformed', 'nextAction'],
  };
  for (const [fileName, required] of Object.entries(simpleRequirements)) {
    const document = documents[fileName];
    common(document, fileName.replace('.json', ''), runId, errors);
    hasKeys(document, required, fileName.replace('.json', ''), errors);
  }

  const gates = documents['GATES.json'];
  if (isObject(gates) && Array.isArray(gates.gates)) {
    for (const gate of gates.gates) {
      hasKeys(gate, ['gateId', 'status', 'evidenceIds'], 'GATES.gates[]', errors);
      if (isObject(gate) && gate.status === 'PASS') {
        assert(Array.isArray(gate.evidenceIds) && gate.evidenceIds.length > 0, 'PASS gate requires evidenceIds', errors);
      }
    }
  } else errors.push('GATES.gates must be an array');

  const evidence = documents['EVIDENCE_INDEX.json'];
  if (isObject(evidence) && Array.isArray(evidence.entries)) {
    for (const entry of evidence.entries) {
      hasKeys(entry, ['evidenceId', 'type', 'capturedAt', 'actor', 'head', 'commandOrSource', 'exitCode', 'result', 'artifactPath', 'stdoutSha256', 'stderrSha256'], 'EVIDENCE_INDEX.entries[]', errors);
      if (isObject(entry) && entry.type === 'review') {
        hasKeys(entry, ['reviewedHead', 'reviewedTree', 'candidateHead', 'candidateTree'], 'EVIDENCE_INDEX.review', errors);
        for (const key of ['reviewedHead', 'reviewedTree', 'candidateHead', 'candidateTree']) {
          assert(nonEmptyString(entry[key]), `EVIDENCE_INDEX.review.${key} must be nonempty`, errors);
        }
      }
    }
  } else errors.push('EVIDENCE_INDEX.entries must be an array');

  const effects = documents['EXTERNAL_EFFECTS.json'];
  if (isObject(effects)) {
    hasKeys(effects, ['effects'], 'EXTERNAL_EFFECTS', errors);
    if (isObject(effects.effects)) {
      const names = Object.keys(effects.effects).sort();
      assert(JSON.stringify(names) === JSON.stringify([...externalEffectCategories].sort()), 'EXTERNAL_EFFECTS.effects must use the canonical ten categories', errors);
      for (const category of externalEffectCategories) hasKeys(effects.effects[category], ['count', 'status', 'evidenceIds'], `EXTERNAL_EFFECTS.effects.${category}`, errors);
    } else errors.push('EXTERNAL_EFFECTS.effects must be an object');
  }

  const finalManifest = documents['FINAL_MANIFEST.json'];
  if (isObject(finalManifest)) {
    assert(finalStatuses.has(finalManifest.statusFinal), 'FINAL_MANIFEST.statusFinal is not canonical', errors);
    assert(finalDecisions.has(finalManifest.decision), 'FINAL_MANIFEST.decision is not canonical', errors);
    assert(['normal', 'recovery'].includes(finalManifest.decisionClass), 'FINAL_MANIFEST.decisionClass is not canonical', errors);
    pair(finalManifest, 'candidateHead', 'candidateTree', 'FINAL_MANIFEST', errors);
  }

  try {
    const handoff = await readFile(path.join(manifestRoot, 'HANDOFF_MANIFEST.md'), 'utf8');
    for (const heading of ['RUN_ID', 'STATUS_FINAL', 'DECISION', 'BASELINE', 'FINDINGS', 'GATES', 'EFFECTS', 'RECOVERY', 'BLOCKERS', 'NEXT', 'CANDIDATE_FREEZE', 'REVIEWS', 'FILES']) {
      assert(new RegExp(`^#{1,6}\\s+${heading}\\s*$`, 'm').test(handoff), `HANDOFF_MANIFEST.md missing heading ${heading}`, errors);
    }
    assert(/no secrets|sem secrets|nenhum segredo/i.test(handoff), 'HANDOFF_MANIFEST.md must state the absence of secrets', errors);
  } catch (error) {
    errors.push(`HANDOFF_MANIFEST.md is not readable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { valid: errors.length === 0, errors, fileCount: observed.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const result = await validateExecutionManifestRoot(process.argv[2]);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.valid ? 0 : 1;
}
