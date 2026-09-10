# Estado Atual e Gaps Pós-MVP

**Status:** `R8_PRESEND_CANDIDATE`
**Baseline R1/R2/R3:** R1 está mergeada; R2 foi mergeada em `#150`; R3 foi
mergeada em `#151`; R4 foi mergeada em `#152`; R5 foi mergeada em `#153`; R6
foi mergeada em `#154`; R7 foi mergeada em `#155`. A base da certificação
pré-SEND R8 é a main `32293e5da1bc9792b3f5d67d30d51639294db897`.
**Escopo desta leitura:** auditoria e certificação pré-SEND com provider fake,
PostgreSQL/Redis/BullMQ TEST descartáveis e zero chamada à Evolution. A prova
live continua exigindo autorização futura do owner vinculada ao target exato.

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
- A matriz R7 usa dados sintéticos e API TEST em memória. Ela não comprova o
  estado atual do ambiente operacional, não autoriza SEND e não torna o sistema
  pronto para uso diário.

## 3. Gaps auditados

| ID     | Classificação                         | Evidência                               | Leitura e próxima ação                                                                                                                             |
| ------ | ------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-01 | `PARTIALLY_FIXED`                     | `E30-CODE-001`, `E30-OP-001`            | Fase 29 corrigiu identidade no código; falta smoke pós-merge de volume/restart em R1                                                               |
| GAP-02 | `CLOSED_BY_R2`                        | PR #150 / evidência R2                  | a allowlist do proxy agora é vinculada aos call-sites reais; nenhuma rota genérica foi adicionada                                                  |
| GAP-03 | `CLOSED_BY_R2`                        | PR #150 / evidência R2                  | control-plane autenticado, quickstart SAFE e CAS stale-write foram certificados sem expor token ao browser                                         |
| GAP-04 | `PARTIALLY_FIXED`                     | `E30-CODE-004`, `E30-OP-001`            | código deriva blockers; causa dos dados operacionais ainda precisa de leitura e correlação; R3                                                     |
| GAP-05 | `REJECTED` como risco de falso online | `E30-CODE-004`                          | `UNKNOWN` é honesto sem heartbeat; não declarar conectado por registro DB. Um contrato de heartbeat futuro é melhoria separada                     |
| GAP-06 | `CLOSED_BY_R4`                        | PR #152 / evidência R4                  | três grupos independentes compartilham uma instância sem colapso de targets; reassignment/lifecycle foram certificados em PostgreSQL e BullMQ TEST |
| GAP-07 | `CLOSED_BY_R5`                        | PR #153 / evidência R5                  | a lista persistida ordenada e sua revision governam a rotação temporal; falha ou indisponibilidade não desloca a fase                              |
| GAP-08 | `CLOSED_BY_R6`                        | PR #154 / evidência R6                  | o Dashboard administra a lista ordenada como rascunho explícito, preserva autoridade do backend e trata CAS/lifecycle sem retry automático         |
| GAP-09 | `CLOSED_BY_R7`                        | PR #155 / evidência R7                  | build de produção, rotas, estados, quatro larguras, teclado e superfícies client-visible de secrets foram certificados em browser real            |
| GAP-10 | `R8_PRESEND_CANDIDATE`                | evidência R8 vinculada ao candidate     | o boundary pré-SEND vincula autorização, tree, job, target, assignment revision e hash do payload; SEND live permanece proibido sem autorização    |
| GAP-11 | `HUMAN_REQUIRED`                      | `E30-DOC-001`                           | retirar pause/ativar operação real jamais é inferido por um agente; R9                                                                             |
| GAP-12 | `CLOSED_BY_R3`                        | PR #151 / evidência R3                  | o snapshot operacional preserva fontes, timestamps, UNKNOWN e blockers correlacionados; readiness diária continua sendo gate posterior             |

## 4. Invariantes e estado atual do GAP-07

Desde a R5 mergeada, a autoridade da rotação é a lista ordenada por
`WhatsAppGroupInstanceAssignment.position`, vinculada à `assignmentRevision`.
O índice temporal estável do slot seleciona a instância; ACK, quantidade de
SENT, sucesso do provider e `lastSentInstanceName` não movem a fase. O binding
inclui instância, revisões, horário e chave do slot antes do enqueue e permanece
sticky no lifecycle. A certificação disposable cobre N=1..4, CAS/reorder,
PostgreSQL, BullMQ, restart/replan e 100 slots com falhas pre-provider. Isso não
autoriza SEND real.

O contrato mergeado da R5 demonstra:

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

## 5. Estado mergeado do GAP-08 e GAP-09

O Dashboard mantém a ordem persistida recebida do backend separada do rascunho
local. Reordenar, adicionar ou remover um WhatsApp não muda o resumo persistido
nem inicia `PATCH`; salvar exige confirmação com ordem anterior e nova. A
`assignmentRevision` é somente leitura nas informações avançadas, enquanto o
CAS continua usando `expectedUpdatedAt` conforme o contrato existente.

Conflitos `409` de CAS ou lifecycle são mostrados sem retry automático. Um CAS
stale permite uma única leitura bounded do snapshot atual; falha de leitura após
write marca a tela como desatualizada e bloqueia nova mutation até refresh bem
sucedido. A UI não calcula `upcomingAssignments`, não cria cursor e não substitui
uma assignment indisponível. Essas garantias foram mergeadas na R6 pelo PR
`#154`.

A certificação R7 mergeada inventaria todas as rotas `page.tsx`, executa as
rotas principais em `390x844`, `768x1024`, `1024x768` e `1440x900` sobre
`next start`, e cobre rotas de detalhe, navegação, erro inicial, vazio, loading,
perda e recuperação da API, teclado e independência entre health público e o
estado funcional de cada página. O proxy same-origin permanece real no teste e
injeta o token sintético somente no servidor.

A verificação de secrets usa sentinels sintéticos distintos no build e no
runtime e inspeciona chunks cliente, HTML/RSC, DOM, URL, storage, cookies,
console e headers iniciados pelo browser. Esses resultados foram mergeados no
PR `#155`.

O candidate pré-SEND R8 mantém o caminho canônico de publicação manual e
adiciona uma fence opcional para a futura prova live. Ela rejeita antes do
provider quando autorização, HEAD/tree, job, dispatch, grupo, hash do destino,
instância, `assignmentRevision`, candidate, snapshot, copy, modo ou hash da
mensagem divergem. O orçamento é consumido antes da chamada ao provider e não
pode exceder um. A allowlist local do destino é validada antes da prontidão de
webhook, pois essa prontidão pode sincronizar estado na Evolution.

No runtime one-shot, a instância configurada também precisa coincidir com a
instância autorizada antes de recovery, criação do provider ou worker. A
readiness genérica de startup permanece no runtime normal, mas é omitida no
one-shot porque o provider a executa após os guards locais e imediatamente
antes do request. Com transporte TEST em memória, o call graph completo usa
dois requests Evolution quando o webhook já está correto e quatro quando exige
sincronização (`find`, `set`, `find`, SEND), dentro do orçamento estrutural de
uma execução autorizada.

O one-shot faz primeiro uma leitura da fila e falha fechada se houver qualquer
job pendente que não corresponda exatamente à autorização; ele não executa o
recovery mutante nessa modalidade. Após o preflight, ele consulta somente o
`jobId` autorizado e executa diretamente a mesma função canônica de dispatch,
sem criar um consumer BullMQ genérico. Assim, um job estranho inserido entre o
preflight e a execução não é claimado, não perde tentativas e não é removido.
A autorização tem janela máxima de trinta minutos, exige `approvedAt <= now`,
`expiresAt >= now` e um intervalo positivo. Estados `PROCESSING`, `SUBMITTED`,
`SENT`, `DELIVERED` e `READ` não reentram pelo runtime one-shot. Essas regras
foram exercitadas somente com PostgreSQL, Redis e BullMQ TEST descartáveis.

Os manifestos schemaVersion 2 são validados contra o protocolo canônico: os
doze nomes são fechados; os campos obrigatórios de cada manifesto, gates,
evidence entries e ledger mensal são verificados; as dez categorias de efeitos
e os pares HEAD/tree de candidate/review precisam ser coerentes. A revisão
independente externa continua pendente; isso não é codificado como um
`statusFinal` inventado.

Essa certificação usa somente infraestrutura TEST e provider fake. Ela não
autoriza Evolution, webhook real ou WhatsApp SEND. R8 live e R9 permanecem
pendentes e `DAILY_USE_READY=false`.

## 6. Limites das evidências R3 e R4

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

## 7. Delta do motor de inventory persistente

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
