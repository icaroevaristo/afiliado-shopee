import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { manifestFileNames, validateExecutionManifestRoot } from './validate-execution-manifests.mjs';

const runId = 'manifest-validator-test'; const sha = 'a'.repeat(40); const tree = 'b'.repeat(40);
const common = (extra = {}) => ({ schemaVersion: 2, runId, createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z', status: 'PASSED', evidenceIds: [], ...extra });
const categories = ['Shopee','OpenAI','Evolution','WhatsAppSEND','OperationalPostgresWrites','OperationalRedisWrites','SchedulerChanges','DockerVolumeChanges','SecretsChanges','PaidCost'];
const manifest = () => ({
  'RUN_MANIFEST.json': { ...common(), mission:'test',scope:'test',owner:'owner',branch:'branch',head:sha,authorizedActions:[],prohibitedActions:[],findingIds:[],gateIds:[],supervisor:'supervisor',singleMutator:'mutator',reviewerA:null,reviewerB:null,finalAdversarial:null,candidateHead:sha,candidateTree:tree,candidateFrozen:true,reviewAHead:null,reviewATree:null,reviewAVerdict:null,reviewBHead:null,reviewBTree:null,reviewBVerdict:null,adversarialHead:null,adversarialTree:null,adversarialVerdict:null,solReconciliationHead:null,solReconciliationTree:null,solReconciliationVerdict:null,mutationsAfterFreeze:[],invalidatedEvidenceIds:[] },
  'BASELINE.json': common({repository:'repo',origin:'origin',expectedOriginMain:sha,observedHead:sha,branch:'branch',ahead:0,behind:0,worktreeClean:true,environmentClass:'TEST'}),
  'ENVIRONMENT.json': common({os:'test',runtimeVersions:{},timezone:'UTC',profile:'TEST',envPresence:{},ports:[],services:[],secretsPrinted:false}),
  'FINDINGS.json': common({findings:[]}),
  'GATES.json': common({gates:[{gateId:'R8-001',status:'PASS',preconditions:[],evidenceIds:['E-1'],blocker:null,owner:'owner'}]}),
  'EVIDENCE_INDEX.json': common({entries:[{evidenceId:'E-1',type:'command',capturedAt:'2026-09-09T00:00:00.000Z',actor:'test',head:sha,commandOrSource:'test',exitCode:0,result:'PASS',redactions:[],artifactPath:'artifact.txt'}]}),
  'EXTERNAL_EFFECTS.json': common({effects:Object.fromEntries(categories.map((name)=>[name,{count:'UNKNOWN',status:'UNKNOWN',evidenceIds:[]}]))}),
  'MONTHLY_COST_LEDGER.json': common({entries:[{month:'2026-09',category:'PaidCost',authorizedBudget:0,observedUsage:'UNKNOWN',currency:'BRL',newRecurringCost:0,owner:'owner',evidenceIds:[],status:'UNKNOWN'}]}),
  'CHANGE_MANIFEST.json': common({filesChanged:[],filesAdded:[],filesDeleted:[],componentsTouched:[],schemaChanged:false,migrationAdded:false,apiContractChanged:false,schedulerChanged:false,sendBoundaryChanged:false,documentationChanged:false,scopeDeviations:[]}),
  'GIT_MANIFEST.json': common({originMainAtStart:sha,originMainAtEnd:sha,branch:'branch',baseSha:sha,headAtStart:sha,headSha:sha,tree,ahead:1,behind:0,commit:sha,remoteHead:sha,worktreeClean:true,prCreated:false,prNumber:null,mergePerformed:false,mergeCommit:null}),
  'FINAL_MANIFEST.json': common({statusFinal:'READY_FOR_GITHUB_REVIEW',phaseId:'R8',objective:'test',decision:'SHIP',decisionClass:'normal',p0:0,p1:0,p2:0,blockingFindings:[],requiredGatesPassed:[],requiredGatesFailed:[],requiredGatesBlocked:[],candidateHead:sha,candidateTree:tree,candidateFrozen:true,reviewAHead:null,reviewATree:null,reviewAVerdict:null,reviewBHead:null,reviewBTree:null,reviewBVerdict:null,adversarialHead:null,adversarialTree:null,adversarialVerdict:null,solReconciliationHead:null,solReconciliationTree:null,solReconciliationVerdict:null,mutationsAfterFreeze:[],invalidatedEvidenceIds:[],externalEffectsSafe:true,scopeCompliant:true,documentationCurrent:true,readyForGithubReview:true,readyForNextPhase:false,dailyUseReady:false,humanRequiredReasons:[],nextRecommendedPhase:'R8B',nextRecommendedAction:'review'}),
});
const headings = ['RUN_ID','STATUS_FINAL','DECISION','BASELINE','FINDINGS','GATES','EFFECTS','RECOVERY','BLOCKERS','NEXT','CANDIDATE_FREEZE','REVIEWS','FILES'];
const handoff = `${headings.map((heading) => `# ${heading}`).join('\n\n')}\n\nNo secrets are included.\n`;
async function fixture(mutate) { const root = await mkdtemp(path.join(os.tmpdir(),'manifest-validator-')); const documents=manifest(); await mutate?.(documents,root); await Promise.all(Object.entries(documents).map(([name,value])=>writeFile(path.join(root,name),JSON.stringify(value)))); await writeFile(path.join(root,'HANDOFF_MANIFEST.md'),handoff); return root; }
const expectInvalid = async (mutate) => { const root=await fixture(mutate); try { assert.equal((await validateExecutionManifestRoot(root)).valid,false); } finally { await rm(root,{recursive:true,force:true}); } };
test('accepts complete canonical schemaVersion 2 manifests', async () => { const root=await fixture(); try { const result=await validateExecutionManifestRoot(root); assert.equal(result.valid,true); assert.equal(result.fileCount,12); } finally { await rm(root,{recursive:true,force:true}); } });
for (const [file,document] of Object.entries(manifest())) for (const field of Object.keys(document)) test(`rejects ${file} without ${field}`,()=>expectInvalid((documents)=>{delete documents[file][field];}));
for (const [file,key] of [['GATES.json','gates'],['EVIDENCE_INDEX.json','entries'],['MONTHLY_COST_LEDGER.json','entries']]) for (const field of Object.keys(manifest()[file][key][0])) test(`rejects ${file} entry without ${field}`,()=>expectInvalid((documents)=>{delete documents[file][key][0][field];}));
test('rejects an invalid gate status', () => expectInvalid((documents) => { documents['GATES.json'].gates[0].status = 'INVALID_STATUS'; }));
test('rejects UNVERIFIED as a gate status', () => expectInvalid((documents) => { documents['GATES.json'].gates[0].status = 'UNVERIFIED'; }));
for (const category of categories) test(`rejects missing ${category} effect category`,()=>expectInvalid((documents)=>{delete documents['EXTERNAL_EFFECTS.json'].effects[category];}));
for (const heading of headings) test(`rejects missing ${heading} handoff heading`, async () => { const root=await fixture(); try { await writeFile(path.join(root,'HANDOFF_MANIFEST.md'),handoff.replace(`# ${heading}`,`# MISSING_${heading}`)); assert.equal((await validateExecutionManifestRoot(root)).valid,false); } finally { await rm(root,{recursive:true,force:true}); } });
test('rejects enum, pair, extra file and directory violations', async () => { const root=await fixture(async (documents,dir)=>{documents['FINAL_MANIFEST.json'].statusFinal='PENDING';documents['RUN_MANIFEST.json'].reviewAHead=sha;await writeFile(path.join(dir,'EXTRA.json'),'{}');await mkdir(path.join(dir,'extra-directory'));}); try { assert.equal((await validateExecutionManifestRoot(root)).valid,false); } finally { await rm(root,{recursive:true,force:true}); } });
