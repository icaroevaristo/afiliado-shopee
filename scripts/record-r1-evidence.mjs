import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const [runId, stepId, ...command] = process.argv.slice(2);
if (!runId || !stepId || command.length === 0) {
  throw new Error('Usage: record-r1-evidence <runId> <stepId> <command> [...args]');
}
const root = process.cwd();
const artifactRoot = resolve(root, '.runtime/autonomous-execution/artifacts', runId);
const manifestRoot = resolve(root, '.runtime/autonomous-execution/manifests', runId);
const evidencePath = join(manifestRoot, 'EVIDENCE_INDEX.json');
if (!existsSync(evidencePath)) throw new Error('Missing canonical EVIDENCE_INDEX.json');
mkdirSync(join(artifactRoot, 'commands'), { recursive: true });
const startedAt = new Date().toISOString();
const executable = process.platform === 'win32' && !command[0].includes('.')
  ? `${command[0]}.cmd`
  : command[0];
const result = spawnSync(executable, command.slice(1), {
  cwd: root,
  encoding: 'utf8',
  shell: false,
});
const finishedAt = new Date().toISOString();
const sanitize = (value) => value.replaceAll(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[REDACTED_DATABASE_URL]').replaceAll(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]');
const stdout = sanitize(result.stdout ?? '');
const stderr = sanitize(result.stderr ?? '');
const write = (suffix, value) => {
  const relative = `commands/${stepId}.${suffix}.txt`;
  const path = join(artifactRoot, relative);
  writeFileSync(path, value, { encoding: 'utf8', mode: 0o600 });
  return { relative, sha256: createHash('sha256').update(value).digest('hex') };
};
const out = write('stdout', stdout);
const err = write('stderr', stderr);
const index = JSON.parse(readFileSync(evidencePath, 'utf8'));
delete index.evidence;
const evidenceId = `E-${stepId}`;
index.entries ??= [];
index.entries = index.entries.filter((entry) => entry.evidenceId !== evidenceId);
index.entries.push({ evidenceId, type: 'command', capturedAt: finishedAt, actor: 'GPT-5.6-TERRA', head: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(), commandOrSource: command.join(' '), exitCode: result.status ?? 1, result: result.status === 0 ? 'PASS' : 'FAIL', redactions: ['DATABASE_URL', 'Authorization'], artifactPath: `artifacts/${runId}/${out.relative}`, stdout: out, stderr: err, startedAt, finishedAt });
index.evidenceIds = index.entries.map((entry) => entry.evidenceId);
index.updatedAt = finishedAt;
writeFileSync(evidencePath, `${JSON.stringify(index, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
process.stdout.write(JSON.stringify({ evidenceId, exitCode: result.status ?? 1, stdout: out, stderr: err }) + '\n');
process.exitCode = result.status ?? 1;
