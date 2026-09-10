import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const manifestFileNames = Object.freeze([
  'RUN_MANIFEST.json', 'BASELINE.json', 'ENVIRONMENT.json', 'FINDINGS.json',
  'GATES.json', 'EVIDENCE_INDEX.json', 'EXTERNAL_EFFECTS.json',
  'MONTHLY_COST_LEDGER.json', 'CHANGE_MANIFEST.json', 'GIT_MANIFEST.json',
  'FINAL_MANIFEST.json', 'HANDOFF_MANIFEST.md',
]);
const statuses = new Set(['PLANNED','PREFLIGHTED','RUNNING','QUIESCING','RESTORING','PASSED','FAILED','BLOCKED','HUMAN_REQUIRED','CLOSED']);
const finalStatuses = new Set(['READY_FOR_GITHUB_REVIEW','DONE_NO_GIT_CHANGE','BLOCKED','HUMAN_REQUIRED','FAILED_VALIDATION']);
const gateStatuses = new Set(['PASS','FAIL','BLOCKED','HUMAN_REQUIRED','NOT_RUN']);
const decisions = new Set(['SHIP','FIX_FIRST','BLOCKED','HUMAN_REQUIRED']);
const effects = ['Shopee','OpenAI','Evolution','WhatsAppSEND','OperationalPostgresWrites','OperationalRedisWrites','SchedulerChanges','DockerVolumeChanges','SecretsChanges','PaidCost'];
const commonFields = ['schemaVersion','runId','createdAt','updatedAt','status','evidenceIds'];
const runFields = ['schemaVersion','runId','createdAt','updatedAt','mission','scope','owner','branch','head','status','authorizedActions','prohibitedActions','findingIds','gateIds','evidenceIds','supervisor','singleMutator','reviewerA','reviewerB','finalAdversarial','candidateHead','candidateTree','candidateFrozen','reviewAHead','reviewATree','reviewAVerdict','reviewBHead','reviewBTree','reviewBVerdict','adversarialHead','adversarialTree','adversarialVerdict','solReconciliationHead','solReconciliationTree','solReconciliationVerdict','mutationsAfterFreeze','invalidatedEvidenceIds'];
const fields = {
  'BASELINE.json':['repository','origin','expectedOriginMain','observedHead','branch','ahead','behind','worktreeClean','environmentClass'],
  'ENVIRONMENT.json':['os','runtimeVersions','timezone','profile','envPresence','ports','services','secretsPrinted'],
  'FINDINGS.json':['findings'], 'GATES.json':['gates'], 'EVIDENCE_INDEX.json':['entries'],
  'EXTERNAL_EFFECTS.json':['effects'], 'MONTHLY_COST_LEDGER.json':['entries'],
  'CHANGE_MANIFEST.json':['filesChanged','filesAdded','filesDeleted','componentsTouched','schemaChanged','migrationAdded','apiContractChanged','schedulerChanged','sendBoundaryChanged','documentationChanged','scopeDeviations'],
  'GIT_MANIFEST.json':['originMainAtStart','originMainAtEnd','branch','baseSha','headAtStart','headSha','tree','ahead','behind','commit','remoteHead','worktreeClean','prCreated','prNumber','mergePerformed','mergeCommit'],
  'FINAL_MANIFEST.json':['statusFinal','phaseId','objective','decision','decisionClass','p0','p1','p2','blockingFindings','requiredGatesPassed','requiredGatesFailed','requiredGatesBlocked','candidateHead','candidateTree','candidateFrozen','reviewAHead','reviewATree','reviewAVerdict','reviewBHead','reviewBTree','reviewBVerdict','adversarialHead','adversarialTree','adversarialVerdict','solReconciliationHead','solReconciliationTree','solReconciliationVerdict','mutationsAfterFreeze','invalidatedEvidenceIds','externalEffectsSafe','scopeCompliant','documentationCurrent','readyForGithubReview','readyForNextPhase','dailyUseReady','humanRequiredReasons','nextRecommendedPhase','nextRecommendedAction'],
};
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const assert = (condition, message, errors) => { if (!condition) errors.push(message); };
const requireKeys = (value, required, label, errors) => {
  assert(isObject(value), `${label} must be an object`, errors);
  if (isObject(value)) for (const key of required) assert(Object.hasOwn(value, key), `${label}.${key} is required`, errors);
};
const pair = (value, left, right, label, errors) => assert((value[left] === null && value[right] === null) || (nonEmpty(value[left]) && nonEmpty(value[right])), `${label}.${left}/${right} must be both null or nonempty strings`, errors);
const validateCommon = (value, label, runId, errors) => {
  requireKeys(value, commonFields, label, errors);
  if (!isObject(value)) return;
  assert(value.schemaVersion === 2, `${label}.schemaVersion must equal 2`, errors);
  assert(value.runId === runId, `${label}.runId must match RUN_MANIFEST.runId`, errors);
  assert(nonEmpty(value.createdAt) && nonEmpty(value.updatedAt), `${label} timestamps must be nonempty`, errors);
  assert(statuses.has(value.status), `${label}.status is not canonical`, errors);
  assert(Array.isArray(value.evidenceIds), `${label}.evidenceIds must be an array`, errors);
};

export async function validateExecutionManifestRoot(root) {
  const errors = [];
  const listing = await readdir(root, { withFileTypes: true });
  const observed = listing.map((entry) => entry.name).sort();
  assert(listing.every((entry) => entry.isFile()), 'manifest root may contain files only', errors);
  assert(JSON.stringify(observed) === JSON.stringify([...manifestFileNames].sort()), 'manifest root must contain exactly the canonical 12 files', errors);
  const docs = {};
  for (const file of manifestFileNames.filter((name) => name.endsWith('.json'))) {
    try { docs[file] = JSON.parse(await readFile(path.join(root, file), 'utf8')); }
    catch (error) { errors.push(`${file} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const run = docs['RUN_MANIFEST.json'];
  const runId = isObject(run) && nonEmpty(run.runId) ? run.runId : undefined;
  requireKeys(run, runFields, 'RUN_MANIFEST', errors);
  if (isObject(run)) {
    assert(run.schemaVersion === 2 && statuses.has(run.status), 'RUN_MANIFEST schema/status invalid', errors);
    assert(Array.isArray(run.mutationsAfterFreeze), 'RUN_MANIFEST.mutationsAfterFreeze must be an array', errors);
    assert(Array.isArray(run.invalidatedEvidenceIds), 'RUN_MANIFEST.invalidatedEvidenceIds must be an array', errors);
    assert(typeof run.candidateFrozen === 'boolean', 'RUN_MANIFEST.candidateFrozen must be boolean', errors);
    for (const [left,right] of [['candidateHead','candidateTree'],['reviewAHead','reviewATree'],['reviewBHead','reviewBTree'],['adversarialHead','adversarialTree'],['solReconciliationHead','solReconciliationTree']]) pair(run,left,right,'RUN_MANIFEST',errors);
  }
  for (const [file, required] of Object.entries(fields)) { validateCommon(docs[file],file.replace('.json',''),runId,errors); requireKeys(docs[file],required,file.replace('.json',''),errors); }
  const gates = docs['GATES.json'];
  if (!isObject(gates) || !Array.isArray(gates.gates)) errors.push('GATES.gates must be an array');
  else for (const gate of gates.gates) {
    requireKeys(gate,['gateId','status','preconditions','evidenceIds','blocker','owner'],'GATES.gates[]',errors);
    if (!isObject(gate)) continue;
    assert(nonEmpty(gate.gateId), 'GATES.gates[].gateId must be a nonempty string', errors);
    assert(gateStatuses.has(gate.status), 'GATES.gates[].status is not canonical', errors);
    assert(Array.isArray(gate.preconditions), 'GATES.gates[].preconditions must be an array', errors);
    assert(Array.isArray(gate.evidenceIds), 'GATES.gates[].evidenceIds must be an array', errors);
    assert(gate.blocker === null || typeof gate.blocker === 'string', 'GATES.gates[].blocker must be null or a string', errors);
    assert(nonEmpty(gate.owner), 'GATES.gates[].owner must be a nonempty string', errors);
    if (gate.status === 'PASS' && Array.isArray(gate.evidenceIds)) assert(gate.evidenceIds.length > 0,'PASS gate requires evidenceIds',errors);
  }
  const evidence = docs['EVIDENCE_INDEX.json'];
  if (!isObject(evidence) || !Array.isArray(evidence.entries)) errors.push('EVIDENCE_INDEX.entries must be an array');
  else for (const entry of evidence.entries) {
    requireKeys(entry,['evidenceId','type','capturedAt','actor','head','commandOrSource','exitCode','result','redactions','artifactPath'],'EVIDENCE_INDEX.entries[]',errors);
    if (isObject(entry)) {
      assert(Array.isArray(entry.redactions),'EVIDENCE_INDEX.entries[].redactions must be an array',errors);
      if (Object.hasOwn(entry,'exitCode')) assert(entry.exitCode === null || Number.isInteger(entry.exitCode),'EVIDENCE_INDEX.entries[].exitCode must be an integer or null',errors);
      if (entry.type === 'review') { requireKeys(entry,['reviewedHead','reviewedTree','candidateHead','candidateTree'],'EVIDENCE_INDEX.review',errors); for (const key of ['reviewedHead','reviewedTree','candidateHead','candidateTree']) assert(nonEmpty(entry[key]),`EVIDENCE_INDEX.review.${key} must be nonempty`,errors); }
    }
  }
  const external = docs['EXTERNAL_EFFECTS.json'];
  if (!isObject(external) || !isObject(external.effects)) errors.push('EXTERNAL_EFFECTS.effects must be an object');
  else { assert(JSON.stringify(Object.keys(external.effects).sort()) === JSON.stringify([...effects].sort()),'EXTERNAL_EFFECTS.effects must use the canonical ten categories',errors); for (const effect of effects) requireKeys(external.effects[effect],['count','status','evidenceIds'],`EXTERNAL_EFFECTS.effects.${effect}`,errors); }
  const ledger = docs['MONTHLY_COST_LEDGER.json'];
  if (!isObject(ledger) || !Array.isArray(ledger.entries)) errors.push('MONTHLY_COST_LEDGER.entries must be an array');
  else for (const entry of ledger.entries) requireKeys(entry,['month','category','authorizedBudget','observedUsage','currency','newRecurringCost','owner','evidenceIds','status'],'MONTHLY_COST_LEDGER.entries[]',errors);
  const final = docs['FINAL_MANIFEST.json'];
  if (isObject(final)) {
    assert(finalStatuses.has(final.statusFinal),'FINAL_MANIFEST.statusFinal is not canonical',errors);
    assert(decisions.has(final.decision),'FINAL_MANIFEST.decision is not canonical',errors);
    assert(['normal','recovery'].includes(final.decisionClass),'FINAL_MANIFEST.decisionClass is not canonical',errors);
    assert(typeof final.candidateFrozen === 'boolean','FINAL_MANIFEST.candidateFrozen must be boolean',errors);
    assert(Array.isArray(final.mutationsAfterFreeze),'FINAL_MANIFEST.mutationsAfterFreeze must be an array',errors);
    assert(Array.isArray(final.invalidatedEvidenceIds),'FINAL_MANIFEST.invalidatedEvidenceIds must be an array',errors);
    for (const [left,right] of [['candidateHead','candidateTree'],['reviewAHead','reviewATree'],['reviewBHead','reviewBTree'],['adversarialHead','adversarialTree'],['solReconciliationHead','solReconciliationTree']]) pair(final,left,right,'FINAL_MANIFEST',errors);
  }
  try { const handoff = await readFile(path.join(root,'HANDOFF_MANIFEST.md'),'utf8'); for (const heading of ['RUN_ID','STATUS_FINAL','DECISION','BASELINE','FINDINGS','GATES','EFFECTS','RECOVERY','BLOCKERS','NEXT','CANDIDATE_FREEZE','REVIEWS','FILES']) assert(new RegExp(`^#{1,6}\\s+${heading}\\s*$`,'m').test(handoff),`HANDOFF_MANIFEST.md missing heading ${heading}`,errors); assert(/no secrets|sem secrets|nenhum segredo/i.test(handoff),'HANDOFF_MANIFEST.md must state the absence of secrets',errors); }
  catch (error) { errors.push(`HANDOFF_MANIFEST.md is not readable: ${error instanceof Error ? error.message : String(error)}`); }
  return { valid: errors.length === 0, errors, fileCount: observed.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) { const result = await validateExecutionManifestRoot(process.argv[2]); process.stdout.write(`${JSON.stringify(result)}\n`); process.exitCode = result.valid ? 0 : 1; }
