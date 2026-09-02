# Execution Manifest Protocol

**Status:** `LIVE_CANONICAL`
**Especificação:** `docs/autonomous-execution/manifests/README.md`
**Diretório de execução:** `.runtime/autonomous-execution/manifests/<RUN_ID>/`
**Schema:** `2` para novas execuções; schema `1` permanece histórico e não é
reescrito.

O manifesto é a unidade de handoff entre tasks e agentes. Deve ser criado
antes de uma operação relevante e fechado somente depois do estado final. O
manifesto não autoriza provider, migration, volume ou remoção de pause.

## Arquivos obrigatórios

Cada `<RUN_ID>` no diretório de execução contém:

```text
RUN_MANIFEST.json
BASELINE.json
ENVIRONMENT.json
FINDINGS.json
GATES.json
EVIDENCE_INDEX.json
EXTERNAL_EFFECTS.json
MONTHLY_COST_LEDGER.json
CHANGE_MANIFEST.json
GIT_MANIFEST.json
FINAL_MANIFEST.json
HANDOFF_MANIFEST.md
```

O diretório `.runtime/` é local/ignorado e não faz parte do candidate Git. O
contrato está resumido em `manifests/README.md`; não se deve materializar uma
execução dentro de `docs/autonomous-execution/manifests/`, que contém apenas a
documentação deste contrato.

### Conjunto fechado e schema mínimo

Para `schemaVersion: 2`, o diretório de uma execução é um conjunto fechado:

```text
EXACT_MANIFEST_FILE_COUNT=12
EXACT_MANIFEST_FILE_SET_VERSION=2
EXTRA_MANIFEST_FILES=FORBIDDEN
EXTRA_MANIFEST_DIRECTORIES=FORBIDDEN
```

Os únicos nomes permitidos são exatamente os do bloco acima, sem alias,
duplicata ou arquivo auxiliar dentro de `<RUN_ID>`. Logs e artifacts grandes
ficam fora do diretório e são referenciados por `artifactPath`; nunca se cria um
`THIRD_MANIFEST` para suprir um campo ausente. Um arquivo ausente, extra,
renomeado ou com tipo diferente torna o run `BLOCKED`/`UNVERIFIED`.

## Forma mínima dos JSON

Todos os JSON de novas execuções têm `schemaVersion: 2`, `runId`, `createdAt`, `updatedAt`,
`status` e `evidenceIds` quando aplicável. Campos desconhecidos usam `null` ou
`UNKNOWN`; nunca são inventados.

O schema mínimo obrigatório por arquivo é:

| Arquivo | Campos mínimos obrigatórios |
| --- | --- |
| `RUN_MANIFEST.json` | `schemaVersion`, `runId`, `createdAt`, `updatedAt`, `mission`, `scope`, `owner`, `branch`, `head`, `status`, `authorizedActions`, `prohibitedActions`, `findingIds`, `gateIds`, `evidenceIds`, `supervisor`, `singleMutator`, `reviewerA`, `reviewerB`, `finalAdversarial`, `candidateHead`, `candidateTree`, `candidateFrozen`, `reviewAHead`, `reviewATree`, `reviewAVerdict`, `reviewBHead`, `reviewBTree`, `reviewBVerdict`, `adversarialHead`, `adversarialTree`, `adversarialVerdict`, `solReconciliationHead`, `solReconciliationTree`, `solReconciliationVerdict`, `mutationsAfterFreeze`, `invalidatedEvidenceIds` |
| `BASELINE.json` | `schemaVersion`, `runId`, `createdAt`, `updatedAt`, `status`, `repository`, `origin`, `expectedOriginMain`, `observedHead`, `branch`, `ahead`, `behind`, `worktreeClean`, `environmentClass`, `evidenceIds` |
| `ENVIRONMENT.json` | `schemaVersion`, `runId`, `createdAt`, `updatedAt`, `status`, `os`, `runtimeVersions`, `timezone`, `profile`, `envPresence`, `ports`, `services`, `secretsPrinted`, `evidenceIds` |
| `FINDINGS.json` | `schemaVersion`, `runId`, `createdAt`, `updatedAt`, `status`, `findings`, `evidenceIds` |
| `GATES.json` | `schemaVersion`, `runId`, `createdAt`, `updatedAt`, `status`, `gates`, `evidenceIds` |
| `EVIDENCE_INDEX.json` | `schemaVersion`, `runId`, `createdAt`, `updatedAt`, `status`, `entries`, `evidenceIds`; cada entry de review também exige `reviewedHead`, `reviewedTree`, `candidateHead` e `candidateTree` |
| `EXTERNAL_EFFECTS.json` | `schemaVersion`, `runId`, `createdAt`, `updatedAt`, `status`, `effects`, `evidenceIds` |
| `MONTHLY_COST_LEDGER.json` | `schemaVersion`, `runId`, `createdAt`, `updatedAt`, `status`, `entries`, `evidenceIds` |
| `CHANGE_MANIFEST.json` | `schemaVersion`, `runId`, `createdAt`, `updatedAt`, `status`, `filesChanged`, `filesAdded`, `filesDeleted`, `componentsTouched`, `schemaChanged`, `migrationAdded`, `apiContractChanged`, `schedulerChanged`, `sendBoundaryChanged`, `documentationChanged`, `scopeDeviations`, `evidenceIds` |
| `GIT_MANIFEST.json` | `schemaVersion`, `runId`, `createdAt`, `updatedAt`, `status`, `originMainAtStart`, `originMainAtEnd`, `branch`, `baseSha`, `headAtStart`, `headSha`, `tree`, `ahead`, `behind`, `commit`, `remoteHead`, `worktreeClean`, `prCreated`, `prNumber`, `mergePerformed`, `mergeCommit`, `evidenceIds` |
| `FINAL_MANIFEST.json` | `schemaVersion`, `runId`, `createdAt`, `updatedAt`, `status`, `statusFinal`, `phaseId`, `objective`, `decision`, `decisionClass`, `p0`, `p1`, `p2`, `blockingFindings`, `requiredGatesPassed`, `requiredGatesFailed`, `requiredGatesBlocked`, `candidateHead`, `candidateTree`, `candidateFrozen`, `reviewAHead`, `reviewATree`, `reviewAVerdict`, `reviewBHead`, `reviewBTree`, `reviewBVerdict`, `adversarialHead`, `adversarialTree`, `adversarialVerdict`, `solReconciliationHead`, `solReconciliationTree`, `solReconciliationVerdict`, `mutationsAfterFreeze`, `invalidatedEvidenceIds`, `externalEffectsSafe`, `scopeCompliant`, `documentationCurrent`, `readyForGithubReview`, `readyForNextPhase`, `dailyUseReady`, `humanRequiredReasons`, `nextRecommendedPhase`, `nextRecommendedAction`, `evidenceIds` |
| `HANDOFF_MANIFEST.md` | headings `RUN_ID`, `STATUS_FINAL`, `DECISION`, `BASELINE`, `FINDINGS`, `GATES`, `EFFECTS`, `RECOVERY`, `BLOCKERS`, `NEXT`, `CANDIDATE_FREEZE`, `REVIEWS`, `FILES` e declaração de ausência de secrets |

Os campos da tabela são obrigatórios mesmo quando o valor é `null`, `[]` ou
`UNKNOWN`. O validador rejeita um schema 2 que omita um campo, acrescente um
arquivo ao conjunto fechado ou use um campo de revisão sem seu par
`reviewedHead`/`reviewedTree`.

### `RUN_MANIFEST.json`

```json
{
  "schemaVersion": 2,
  "runId": "R1-2026-09-01-example",
  "createdAt": "2026-09-01T00:00:00Z",
  "updatedAt": "2026-09-01T00:00:00Z",
  "mission": "texto curto",
  "scope": "docs|read_only|mutation_controlled",
  "owner": "SOL_SUPERVISOR",
  "branch": "branch verificada",
  "head": "sha",
  "status": "PLANNED|PREFLIGHTED|RUNNING|QUIESCING|RESTORING|PASSED|FAILED|BLOCKED|HUMAN_REQUIRED|CLOSED",
  "authorizedActions": [],
  "prohibitedActions": [],
  "findingIds": [],
  "gateIds": [],
  "evidenceIds": [],
  "supervisor": "SOL_SUPERVISOR",
  "singleMutator": "LUNA_MAX",
  "reviewerA": null,
  "reviewerB": null,
  "finalAdversarial": null,
  "candidateHead": null,
  "candidateTree": null,
  "candidateFrozen": false,
  "reviewAHead": null,
  "reviewATree": null,
  "reviewAVerdict": null,
  "reviewBHead": null,
  "reviewBTree": null,
  "reviewBVerdict": null,
  "adversarialHead": null,
  "adversarialTree": null,
  "adversarialVerdict": null,
  "solReconciliationHead": null,
  "solReconciliationTree": null,
  "solReconciliationVerdict": null,
  "mutationsAfterFreeze": [],
  "invalidatedEvidenceIds": []
}
```

### Outros arquivos

- `BASELINE.json`: repository, origin, expected/observed SHA, branch,
  ahead/behind, worktree, classe do ambiente e, se aplicável, identidade
  sanitizada de DB/Compose/volume. Nunca valores de secrets.
- `ENVIRONMENT.json`: OS, versões, timezone, profile (`TEST`,
  `LOCAL_ISOLATED`, `LOCAL_OPERATIONAL` etc.), presença/ausência de env keys
  como booleanos e portas/serviços como metadata.
- `FINDINGS.json`: registros conforme `FINDING_LEDGER_SCHEMA.md`, incluindo
  findings herdados e decisão de fechamento.
- `GATES.json`: `{gateId, status, preconditions, evidenceIds, blocker, owner}`;
  `PASS` sem evidence ID é inválido.
- `EVIDENCE_INDEX.json`: referências com `evidenceId`, `type`, `capturedAt`,
  `actor`, `head`, `commandOrSource`, `exitCode` quando houver, `result`,
  `redactions` e `artifactPath`; sem segredos.
- `EXTERNAL_EFFECTS.json`: categorias `Shopee`, `OpenAI`, `Evolution`,
  `WhatsAppSEND`, `OperationalPostgresWrites`, `OperationalRedisWrites`,
  `SchedulerChanges`, `DockerVolumeChanges`, `SecretsChanges` e `PaidCost`.
  Cada item é `{count, status, evidenceIds}`; se não medido, `count` é
  `UNKNOWN`, nunca zero inferido.
- `MONTHLY_COST_LEDGER.json`: entradas com `{month, category,
  authorizedBudget, observedUsage, currency, newRecurringCost, owner,
  evidenceIds, status}`. Categorias e semântica seguem o contrato de custo do
  Master Spec; uso não medido é `UNKNOWN` e exige blocker/decisão.
- `CHANGE_MANIFEST.json`: descreve o delta autorizado e todos os componentes
  tocados. Campos `schemaChanged`, `migrationAdded`, `apiContractChanged`,
  `schedulerChanged` e `sendBoundaryChanged` tornam o blast radius explícito.
- `GIT_MANIFEST.json`: vincula origin/base/branch/HEAD/tree e estado de release;
  `prCreated` e `mergePerformed` não podem ser inferidos.
- `FINAL_MANIFEST.json`: decisão final, estado dos gates, findings, efeitos,
  escopo e readiness. `statusFinal` aceita somente os valores definidos abaixo.
- `HANDOFF_MANIFEST.md`: resumo humano apontando para os doze arquivos,
  baseline, findings, gates, efeitos, recovery, blockers e próximos passos.

### `CHANGE_MANIFEST.json`

```json
{
  "schemaVersion": 2,
  "runId": "R1-2026-09-01-example",
  "createdAt": "2026-09-01T00:00:00Z",
  "updatedAt": "2026-09-01T00:00:00Z",
  "status": "CLOSED",
  "filesChanged": [],
  "filesAdded": [],
  "filesDeleted": [],
  "componentsTouched": [],
  "schemaChanged": false,
  "migrationAdded": false,
  "apiContractChanged": false,
  "schedulerChanged": false,
  "sendBoundaryChanged": false,
  "documentationChanged": false,
  "scopeDeviations": [],
  "evidenceIds": []
}
```

### `GIT_MANIFEST.json`

```json
{
  "schemaVersion": 2,
  "runId": "R1-2026-09-01-example",
  "createdAt": "2026-09-01T00:00:00Z",
  "updatedAt": "2026-09-01T00:00:00Z",
  "status": "CLOSED",
  "originMainAtStart": null,
  "originMainAtEnd": null,
  "branch": null,
  "baseSha": null,
  "headAtStart": null,
  "headSha": null,
  "tree": null,
  "ahead": null,
  "behind": null,
  "commit": null,
  "remoteHead": null,
  "worktreeClean": null,
  "prCreated": false,
  "prNumber": null,
  "mergePerformed": false,
  "mergeCommit": null,
  "evidenceIds": []
}
```

### `FINAL_MANIFEST.json`

```json
{
  "schemaVersion": 2,
  "runId": "R1-2026-09-01-example",
  "createdAt": "2026-09-01T00:00:00Z",
  "updatedAt": "2026-09-01T00:00:00Z",
  "status": "CLOSED",
  "statusFinal": "READY_FOR_GITHUB_REVIEW",
  "phaseId": "R1",
  "objective": "texto curto",
  "decision": "SHIP|FIX_FIRST|BLOCKED|HUMAN_REQUIRED",
  "decisionClass": "normal|recovery",
  "p0": 0,
  "p1": 0,
  "p2": 0,
  "blockingFindings": [],
  "requiredGatesPassed": [],
  "requiredGatesFailed": [],
  "requiredGatesBlocked": [],
  "candidateHead": null,
  "candidateTree": null,
  "candidateFrozen": false,
  "reviewAHead": null,
  "reviewATree": null,
  "reviewAVerdict": null,
  "reviewBHead": null,
  "reviewBTree": null,
  "reviewBVerdict": null,
  "adversarialHead": null,
  "adversarialTree": null,
  "adversarialVerdict": null,
  "solReconciliationHead": null,
  "solReconciliationTree": null,
  "solReconciliationVerdict": null,
  "mutationsAfterFreeze": [],
  "invalidatedEvidenceIds": [],
  "externalEffectsSafe": null,
  "scopeCompliant": null,
  "documentationCurrent": null,
  "readyForGithubReview": null,
  "readyForNextPhase": null,
  "dailyUseReady": null,
  "humanRequiredReasons": [],
  "nextRecommendedPhase": null,
  "nextRecommendedAction": null,
  "evidenceIds": []
}
```

`statusFinal` só pode ser `READY_FOR_GITHUB_REVIEW`, `DONE_NO_GIT_CHANGE`,
`BLOCKED`, `HUMAN_REQUIRED` ou `FAILED_VALIDATION`.
`READY_FOR_NEXT_PHASE` é uma decisão de handoff representada em `decision` ou
`nextRecommendedAction`, com `readyForNextPhase=true`; não é um sexto
`statusFinal`.

### Candidate freeze e SHA-bound review

Antes de `REVIEWER_A`, registrar `candidateHead`, `candidateTree` e
`candidateFrozen=true`. `candidateTree` é um digest verificável da árvore Git no
mesmo snapshot do `candidateHead`; não é um nome de diretório. Cada reviewer,
adversarial, ship gate e reconciliação registra seu próprio par
`reviewedHead`/`reviewedTree` nos campos correspondentes do
`RUN_MANIFEST`/`FINAL_MANIFEST` e no `EVIDENCE_INDEX`. Os campos concretos são
`reviewAHead`/`reviewATree`, `reviewBHead`/`reviewBTree`,
`adversarialHead`/`adversarialTree` e
`solReconciliationHead`/`solReconciliationTree`; o `GIT_MANIFEST` também
carrega o `tree` correspondente a `headSha`.

Qualquer mutation depois do freeze zera `candidateFrozen`, adiciona a mutation a
`mutationsAfterFreeze`, calcula `invalidatedEvidenceIds` e exige novo candidato.
Uma aprovação cujo `reviewedHead` ou `reviewedTree` divergir do candidato é
`INVALID`, não uma aprovação parcial.

## Ciclo de vida

```text
PLANNED → PREFLIGHTED → RUNNING → QUIESCING → RESTORING → PASSED → CLOSED
                    ↘ BLOCKED / HUMAN_REQUIRED / FAILED
```

Após possível efeito externo, o run não volta para `RUNNING` por retry. O
SOL_SUPERVISOR congela novos efeitos, preserva o lifecycle e registra
investigação. Nenhum agente apaga manifesto fechado para “limpar” histórico.

## Validação

Antes do handoff: validar os doze arquivos, JSON/schema, links de evidence,
ausência de secrets, escopo de diff, coerência de branch/SHA/tree, invariantes e
efeitos. Se um artefato não puder ser anexado, declarar o run/gate como
`BLOCKED` e a claim como `UNVERIFIED`, com motivo.
