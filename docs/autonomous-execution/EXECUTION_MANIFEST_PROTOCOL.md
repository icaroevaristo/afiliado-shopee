# Execution Manifest Protocol

**Status:** `LIVE_CANONICAL`
**Diretório:** `docs/autonomous-execution/manifests/<RUN_ID>/`
**Schema:** `1`

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
HANDOFF_MANIFEST.md
```

O contrato de diretório está resumido em `manifests/README.md`.

## Forma mínima dos JSON

Todos os JSON têm `schemaVersion: 1`, `runId`, `createdAt`, `updatedAt`,
`status` e `evidenceIds` quando aplicável. Campos desconhecidos usam `null` ou
`UNKNOWN`; nunca são inventados.

### `RUN_MANIFEST.json`

```json
{
  "schemaVersion": 1,
  "runId": "R1-2026-09-01-example",
  "mission": "texto curto",
  "scope": "docs|read_only|mutation_controlled",
  "owner": "Orchestrator",
  "branch": "branch verificada",
  "head": "sha",
  "status": "PLANNED|PREFLIGHTED|RUNNING|QUIESCING|RESTORING|PASSED|FAILED|BLOCKED|HUMAN_REQUIRED|CLOSED",
  "authorizedActions": [],
  "prohibitedActions": [],
  "findingIds": [],
  "gateIds": [],
  "evidenceIds": []
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
- `HANDOFF_MANIFEST.md`: resumo humano apontando para os JSON, baseline,
  findings, gates, efeitos, recovery, blockers e próximos passos.

## Ciclo de vida

```text
PLANNED → PREFLIGHTED → RUNNING → QUIESCING → RESTORING → PASSED → CLOSED
                    ↘ BLOCKED / HUMAN_REQUIRED / FAILED
```

Após possível efeito externo, o run não volta para `RUNNING` por retry. O
Orchestrator congela novos efeitos, preserva o lifecycle e registra
investigação. Nenhum agente apaga manifesto fechado para “limpar” histórico.

## Validação

Antes do handoff: validar JSON/schema, links de evidence, ausência de secrets,
escopo de diff, coerência de branch/SHA, invariantes e efeitos. Se um artefato
não puder ser anexado, declarar o run/gate como `BLOCKED` e a claim como
`UNVERIFIED`, com motivo.
