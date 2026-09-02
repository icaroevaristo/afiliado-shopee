# Evidence Contract — Prova, Redação e Handoff

**Status:** `LIVE_CANONICAL`
**Objetivo:** impedir que narrativa, teste não executado ou estado histórico
seja apresentado como prova atual.

## Identidade

Todo artefato de prova recebe um ID estável, por exemplo:

```text
E30-BASE-001       baseline Git
E30-CODE-001       inspeção de código
E30-DOC-001        decisão/classificação documental
E30-TEST-001       teste reproduzível
E30-OP-001         estado operacional
E30-REVIEW-001     review independente
```

O ID deve registrar no manifesto `type`, `capturedAt`, `actor`, `head`,
`commandOrSource`, `exitCode` quando houver, `result`, `redactions` e
`artifactPath` quando existir.

Evidência de revisão deve registrar também `reviewedHead` e `reviewedTree`.
Quando fizer parte de um candidato congelado, deve apontar para o mesmo
`candidateHead`/`candidateTree`; divergência torna a aprovação `INVALID`.

## Tipos aceitos

- saída de comando com comando, exit code e SHA;
- teste ou relatório de teste realmente executado;
- diff/status Git;
- consulta DB READ_ONLY com identidade e query sanitizadas;
- estado/inspect Docker sanitizado;
- estado de Redis/queue somente leitura;
- resposta API sanitizada e código HTTP;
- screenshot/browser trace;
- log sanitizado com timestamp/correlation ID;
- receipt de provider somente em task autorizada;
- migration/queue/lifecycle state;
- argumento arquitetural forte, quando a reprodução direta não é possível e
  as premissas ficam explícitas.

Uma lista de arquivos ou uma intenção no roadmap é evidência documental, não
prova de runtime.

## Resultado

Cada gate registra exclusivamente um de:

`PASS`, `FAIL`, `BLOCKED`, `HUMAN_REQUIRED` ou `NOT_RUN`, conforme
`GATE_MATRIX.md`. `UNVERIFIED` descreve uma claim/evidence não coletada; nesse
caso o gate permanece `NOT_RUN` ou `BLOCKED`, nunca ganha um sexto estado.
`PASS` exige evidência que atenda o mínimo do `GATE_MATRIX.md`.

## Redação e secrets

- Nunca registrar valores de API key, token, senha, DSN, Authorization,
  cookie, JID/telefone completo ou payload comercial desnecessário.
- Testes de vazamento usam somente marcador fake, como
  `TEST_SECRET_MUST_NEVER_APPEAR`.
- Para provar auth, registrar booleanos `configured`/`authenticated`, status
  HTTP e predicate; não serializar headers.
- Logs e artifacts devem passar por scan antes do handoff.
- `UNKNOWN` é preferível a inferência otimista.

## Candidate freeze

Antes da revisão final, o `SOL_SUPERVISOR` calcula e atesta um digest verificável
da árvore Git junto ao SHA; o registro é escrito somente no armazenamento de
evidência local/ignorado `.runtime/autonomous-execution/manifests/<RUN_ID>/`:

```text
CANDIDATE_HEAD=<SHA>
CANDIDATE_TREE=<tree digest>
CANDIDATE_FROZEN=true
```

Cada `REVIEWER_A`, `REVIEWER_B`, adversarial, ship gate e Sol reconciliation
declara `reviewedHead` e `reviewedTree`; no `RUN_MANIFEST`/`FINAL_MANIFEST`, os
pares são `reviewAHead`/`reviewATree`, `reviewBHead`/`reviewBTree`,
`adversarialHead`/`adversarialTree` e
`solReconciliationHead`/`solReconciliationTree`. Uma mutation depois do freeze exige
`NEW_CANDIDATE_REQUIRED=true`, lista de `invalidatedEvidenceIds` e nova revisão;
nenhuma aprovação de snapshot anterior permanece válida.

## Tempo e escopo

O manifesto deve separar `historical`, `static_current` e `live_current`.
Commit, branch, banco, volume, filas, providers e custos são fatos com
validade temporal; sempre registrar o SHA e horário local/UTC quando a precisão
for relevante.

## E30 evidence index

| ID | Tipo | Significado neste pacote |
| --- | --- | --- |
| E30-BASE-001 | baseline | Git e worktree revalidados antes da branch documental |
| E30-SKILL-001 | skills | catálogo e leitura dos paths reais das skills aplicadas |
| E30-CODE-001 | static_current | identidade Compose/volume, supervisor e testes relacionados |
| E30-CODE-002 | static_current | planner, target e schema sticky por uma instância |
| E30-CODE-003 | static_current | allowlist do proxy versus call sites de Ofertas |
| E30-CODE-004 | static_current | blockers derivados e health `UNKNOWN` |
| E30-CODE-005 | static_current | auth server-side/proxy; quickstart ainda não provado |
| E30-DOC-001 | documentary | precedência MVP/pós-MVP e decisão humana de ativação |
| E30-DOC-002 | documentary | constituição single-integrator/review READ_ONLY |
| E30-DOC-003 | documentary | preservação do send boundary e escopo sem refactor |
| E30-DOC-004 | documentary | contrato de manifest/handoff |
| E30-DOC-005 | documentary | política de custo sem serviço pago novo não autorizado |
| E30-DOC-006 | validation | estrutura do pacote, escopo docs-only e `git diff --cached --check` passaram |
| E30-DOC-007 | validation | estados, IDs, cobertura R1–R9 e ausência de aliases inconsistentes revalidados após review |
| E30-REDTEAM-001 | review | checklist adversarial documental executado; inconsistências encontradas foram corrigidas e não restaram P0/P1/P2 |
| E30-SOL-001 | review | Sol/Ramanujan READ_ONLY confirmou P0=0, P1=0, P2=0 e `APPROVED` no snapshot final |
| E30-SHIP-001 | ship | escopo docs-only, secret scan e `git diff --cached --check` passaram antes do commit |
| E30-OP-001 | operational | não executado nesta fase; readiness/queues/providers atuais são UNKNOWN |
| E30-DOC-008 | validation | correção documental dos seis P1s, doze manifestos, papéis, freeze SHA/tree e playbook E0–E10 revalidados |
| E30-SKILL-002 | skills | paths reais das skills aplicadas nesta correção foram verificados antes da mutation |
| E30-DOC-009 | validation | pacote docs-only completo revalidado após o FIX_FIRST: baseline/escopo/hierarquia, schema fechado dos doze manifestos, pares SHA/tree, Sol/Luna, R5 e estados normal/recovery do E9 |

Esta tabela é apenas um catálogo sanitizado dos IDs desta arquitetura; não é
um `EVIDENCE_INDEX.json` completo. Cada execução futura deve registrar, para
cada ID, actor, timestamp, SHA, origem/comando, resultado, redactions e
artifact path conforme o contrato acima.

Após esta validação, IDs adicionais (`E30-DOC-008+`, `E30-REDTEAM-*`,
`E30-SOL-*` ou `E30-SHIP-*`) só devem ser adicionados quando a ação
correspondente tiver sido realmente executada.
