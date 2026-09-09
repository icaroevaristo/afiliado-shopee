# Estado Atual e Gaps Pós-MVP

**Status:** `LIVE_CANONICAL`
**Baseline R1/R2/R3:** R1 está mergeada; R2 foi mergeada em `#150`; R3 foi
mergeada em `#151`. A base da certificação R4 é a main
`608971960146d8e3c80a76d5fd4959e87a6e7977`.
**Escopo desta leitura:** código e certificação R4 em PostgreSQL/Redis TEST
descartáveis. Os recursos canônicos permaneceram parados e sem mutação. Nenhum
provider externo foi iniciado. A R4 permanece candidate até revisão e merge.

## 1. Classificação documental

| Fonte                                               | Classificação         | Uso correto                                                                        |
| --------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------- |
| `docs/PROJECT-ROADMAP.md`                           | `LIVE_CANONICAL`      | escopo/status macro do MVP; o SHA nele é checkpoint histórico                      |
| `AGENTS.md`                                         | `LIVE_REFERENCE`      | contratos e guardrails do repositório; código atual prevalece em divergência       |
| `CODEX.md`                                          | `LIVE_REFERENCE`      | arquitetura e operação documentadas; não substitui evidência de runtime            |
| `README.md`                                         | `LIVE_REFERENCE`      | quickstarts e contratos locais; claims operacionais são históricos até revalidação |
| `docs/shopee-affiliate.md`                          | `LIVE_REFERENCE`      | contratos Shopee/ofertas; conferir rotas e código                                  |
| `docs/phase-7-destinations-publication-policies.md` | `HISTORICAL_EVIDENCE` | decisões/invariantes da fase, não estado atual                                     |
| `docs/phase-8-dispatch-outbox-sender-lifecycle.md`  | `HISTORICAL_EVIDENCE` | contrato de lifecycle e evidência histórica                                        |
| `docs/phase-9-e2e-no-send.md`                       | `HISTORICAL_EVIDENCE` | no-SEND e recovery históricos                                                      |
| `docs/phase-10-runtime-normalization.md`            | `HISTORICAL_EVIDENCE` | claims de normalização/readiness da fase, não estado atual                         |
| `docs/phase-1` a `phase-4`                          | `HISTORICAL_EVIDENCE` | contratos de identidade, seleção e provenance; código é autoridade                 |
| `docs/dashboard-design.md`                          | `SUPERSEDED`          | direção visual anterior; contém afirmações que antecedem Dashboard 2.0             |
| `apps/dashboard/DESIGN.md`                          | `LIVE_REFERENCE`      | princípios visuais e UX; não é contrato de API                                     |
| `docs/DASHBOARD-2-IMPLEMENTATION-PLAN.md`           | `LIVE_REFERENCE`      | mapa de capacidade/UX; endpoints e código vencem a tabela                          |
| `docs/autonomous-execution/*`                       | `LIVE_CANONICAL`      | governança pós-MVP, readiness e handoff                                            |

`AMBIGUOUS` deve ser usado no futuro quando a fonte não puder ser resolvida;
esta tabela não converte documento antigo em verdade atual.

## 2. Estado de implementação observado

### Proteções já presentes no código

- Compose operacional recebe `--project-name afiliado-shopee`.
- O supervisor valida identidade, volume PostgreSQL, ownership, portas,
  processos, lock e shutdown sem `down -v` no fluxo normal.
- `system:status` expõe project/volume sanitizados.
- O dashboard usa proxy same-origin com Authorization server-side.
- R2 fechou a matriz de call-sites do proxy, o control-plane autenticado e o
  conflito CAS stale-write; health público continua distinto de control-plane.
- `OperationalAdminService` deriva blockers de grupo, campanha, assignment,
  quota, cooldown, pausa e disponibilidade.
- Scheduler comercial cria targets com `scheduleRevision`, `slotKey`,
  `scheduledFor`, grupo e uma instância sticky.
- Sender/worker/recovery preservam o contrato de attempt crítico e estado
  ambíguo sem retry automático.

### Limitações observadas

- Status de fila, scheduler, provider e instância só pode ser afirmado quando
  a fonte correspondente estiver presente e atual; ausência de fonte não é
  fila vazia, provider online ou instância conectada.
- O schema mantém o campo primário legado
  `WhatsAppDestination.assignedInstanceName`, a revisão
  `assignmentRevision` e a coleção ordenada
  `WhatsAppGroupInstanceAssignment`. A certificação R4 cobre somente uma
  instância compartilhada por vários grupos; rotação de várias instâncias em um
  grupo pertence à R5.
- A instância é apresentada com health `UNKNOWN`; isso é seguro, mas a
  certificação de um heartbeat autoritativo ainda não existe.
- Os blockers são derivados e ricos, mas a causa dos grupos concretos do
  ambiente operacional não foi lida nesta missão documental.
- Browser smoke nas quatro larguras e quickstart autenticado pós-merge não
  possuem evidência atual nesta branch.

## 3. Gaps auditados

| ID     | Classificação                         | Evidência                                   | Leitura e próxima ação                                                                                                                          |
| ------ | ------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-01 | `PARTIALLY_FIXED`                     | `E30-CODE-001`, `E30-OP-001`                | Fase 29 corrigiu identidade no código; falta smoke pós-merge de volume/restart em R1                                                            |
| GAP-02 | `CLOSED_BY_R2`                        | PR #150 / evidência R2                      | a allowlist do proxy agora é vinculada aos call-sites reais; nenhuma rota genérica foi adicionada                                               |
| GAP-03 | `CLOSED_BY_R2`                        | PR #150 / evidência R2                      | control-plane autenticado, quickstart SAFE e CAS stale-write foram certificados sem expor token ao browser                                      |
| GAP-04 | `PARTIALLY_FIXED`                     | `E30-CODE-004`, `E30-OP-001`                | código deriva blockers; causa dos dados operacionais ainda precisa de leitura e correlação; R3                                                  |
| GAP-05 | `REJECTED` como risco de falso online | `E30-CODE-004`                              | `UNKNOWN` é honesto sem heartbeat; não declarar conectado por registro DB. Um contrato de heartbeat futuro é melhoria separada                  |
| GAP-06 | `R4_CANDIDATE`                        | evidência R4 disposable vinculada ao candidate | três grupos independentes compartilham uma instância sem colapso de targets; reassignment/lifecycle são certificados em PostgreSQL e BullMQ TEST; revisão e merge permanecem pendentes |
| GAP-07 | `PARTIALLY_FIXED`                     | `E30-CODE-002`, `E141-DB-004`               | branch atual representa assignment ordenada, revision e binding por slot; revisão independente e readiness operacional continuam pendentes      |
| GAP-08 | `OPEN`                                | `E30-CODE-002`                              | UI atual expressa um número responsável, não ordem/estratégia N-sender; R6                                                                      |
| GAP-09 | `OPEN`                                | `E30-OP-001`                                | browser/Playwright não foi executado nesta missão; R7 deve produzir screenshots/traces ou BLOCKED                                               |
| GAP-10 | `OPEN`                                | `E30-OP-001`                                | checklist final deve encadear start, banco canônico, preview, restart, recovery e SEND controlado; R8                                           |
| GAP-11 | `HUMAN_REQUIRED`                      | `E30-DOC-001`                               | retirar pause/ativar operação real jamais é inferido por um agente; R9                                                                          |
| GAP-12 | `CLOSED_BY_R3`                        | PR #151 / evidência R3                      | o snapshot operacional preserva fontes, timestamps, UNKNOWN e blockers correlacionados; readiness diária continua sendo gate posterior          |

## 4. Invariantes e estado atual do GAP-07

Na branch atual, o modelo de assignment ordenada e o binding de instância por
slot estão implementados com revisão persistida. A certificação disposable de
100 slots cobre rotação A/B derivada de ACK persistido, concorrência de claim,
handoff, refill e múltiplas expirações. O status documental permanece
`PARTIALLY_FIXED` até a revisão independente do candidate final e os gates
operacionais que não pertencem a esta task.

O futuro R5 só pode ser aprovado se demonstrar:

```text
ORDERED_GROUP_INSTANCE_ASSIGNMENTS = [N1, N2, ..., N]
SLOT_INSTANCE_BOUND_BEFORE_ENQUEUE = true
SLOT_INSTANCE_BOUND_BEFORE_SEND = true
INSTANCE_FAILURE_DOES_NOT_SHIFT_ROTATION = true
RESTART_ROTATION_DRIFT = 0
REPLAN_ROTATION_DRIFT = 0
STALE_ASSIGNMENT_REVISION_SEND = 0
SILENT_REROUTE = 0
DEFAULT_INSTANCE_FALLBACK = 0
```

Exemplo obrigatório: se 08:15 foi reservado para N2 e N2 está indisponível,
08:30 continua sendo N1, não a “próxima instância saudável”. Falhar o slot é
preferível a mudar o contrato sem decisão explícita.

## 5. Limites das evidências R3 e R4

A fixture SAFE isolada comprovou `paused=true`, health local de PostgreSQL e
Redis TEST, leitura autenticada do control-plane e medições atuais das filas da
fixture. Zeros de fila ou de uso só são mostrados quando a respectiva fonte foi
consultada; fonte ausente ou indisponível permanece `UNKNOWN`/`UNAVAILABLE`.

Essa evidência não afirma o estado dos dados, filas ou providers do ambiente
canônico/operacional. Ela também não prova Evolution conectada, instância
WhatsApp saudável, quota externa disponível, autorização de SEND ou
`DAILY_USE_READY`.

A certificação R4 usa três grupos sintéticos, cada um com uma única assignment
para a mesma instância, e não inicia worker nem provider. Ela prova persistência,
planejamento, materialização BullMQ sem consumer e concorrência de reassignment
no ambiente TEST. Não certifica rotação N→1 da R5 nem autoriza SEND.

Os nomes de status acima seguem exclusivamente o vocabulário de
`FINDING_LEDGER_SCHEMA.md`; não usar `CONFIRMED_OPEN`, `ALREADY_FIXED` ou
`HUMAN_DECISION_REQUIRED` como estados alternativos. O ledger inicial não
afirma que gaps foram corrigidos; fases futuras devem copiar os registros
relevantes para o manifesto da execução e acrescentar evidência nova.

## 6. Delta do motor de inventory persistente

O estado corrente desta branch adiciona `CommercialDiscoveryCheckpoint` e
`CommercialPreparedMessage`. Discovery, mining e preparação de copy pertencem
ao supervisor do heartbeat, com checkpoint/lease/replay persistentes. O target
agendado apenas valida o target sticky e faz claim transacional de uma mensagem
`READY`; fila vazia termina em `COMMERCIAL_READY_INVENTORY_EMPTY`.

```text
SHOPEE_IN_SLOT_PATH=false
OPENAI_IN_SLOT_PATH=false
```

Recovery de reserva consulta run, outbox e dispatch antes de reabrir uma linha.
Qualquer evidência lógica de confirmação fecha a linha como `DISPATCHED`.
Testes unitários cobrem replay de duas páginas, READY vazio e crash antes/depois
do outbox. PostgreSQL e Redis disposable permanecem gates separados da
infraestrutura operacional.
