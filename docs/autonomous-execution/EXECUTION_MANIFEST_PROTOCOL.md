# Execution Manifest Protocol

**Status:** `LIVE_CANONICAL`
**Diretório:** `docs/autonomous-execution/manifests/<RUN_ID>/`
**Schema:** `2` para novas execuções; schema `1` permanece histórico e não é
reescrito.

O manifesto é a unidade de handoff entre tasks e agentes. Deve ser criado
antes de uma operação relevante e fechado somente depois do estado final. O
manifesto não autoriza provider, migration, volume ou remoção de pause.

## Arquivos obrigatórios

Cada `<RUN_ID>` contém:

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

O contrato de diretório está resumido em `manifests/README.md`.

## Forma mínima dos JSON

Todos os JSON de novas execuções têm `schemaVersion: 2`, `runId`, `createdAt`, `updatedAt`,
`status` e `evidenceIds` quando aplicável. Campos desconhecidos usam `null` ou
`UNKNOWN`; nunca são inventados.

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
  "reviewAVerdict": null,
  "reviewBHead": null,
  "reviewBVerdict": null,
  "adversarialHead": null,
  "adversarialVerdict": null,
  "solReconciliationHead": null,
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
  "reviewAVerdict": null,
  "reviewBHead": null,
  "reviewBVerdict": null,
  "adversarialHead": null,
  "adversarialVerdict": null,
  "solReconciliationHead": null,
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
adversarial, ship gate e reconciliação registra seu próprio `reviewedHead` e
`reviewedTree` nos campos correspondentes do `RUN_MANIFEST`/`FINAL_MANIFEST` e
no `EVIDENCE_INDEX`.

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
