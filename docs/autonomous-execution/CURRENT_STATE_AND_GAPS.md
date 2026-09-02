# Estado Atual e Gaps Pós-MVP

**Status:** `LIVE_CANONICAL`
**HEAD auditado:** `441c154650c808e496c3d9848f05e72ef40ddc95`
**Escopo desta leitura:** código e documentação; nenhum runtime, DB, Redis ou
provider foi iniciado nesta missão.

## 1. Classificação documental

| Fonte | Classificação | Uso correto |
| --- | --- | --- |
| `docs/PROJECT-ROADMAP.md` | `LIVE_CANONICAL` | escopo/status macro do MVP; o SHA nele é checkpoint histórico |
| `AGENTS.md` | `LIVE_REFERENCE` | contratos e guardrails do repositório; código atual prevalece em divergência |
| `CODEX.md` | `LIVE_REFERENCE` | arquitetura e operação documentadas; não substitui evidência de runtime |
| `README.md` | `LIVE_REFERENCE` | quickstarts e contratos locais; claims operacionais são históricos até revalidação |
| `docs/shopee-affiliate.md` | `LIVE_REFERENCE` | contratos Shopee/ofertas; conferir rotas e código |
| `docs/phase-7-destinations-publication-policies.md` | `HISTORICAL_EVIDENCE` | decisões/invariantes da fase, não estado atual |
| `docs/phase-8-dispatch-outbox-sender-lifecycle.md` | `HISTORICAL_EVIDENCE` | contrato de lifecycle e evidência histórica |
| `docs/phase-9-e2e-no-send.md` | `HISTORICAL_EVIDENCE` | no-SEND e recovery históricos |
| `docs/phase-10-runtime-normalization.md` | `HISTORICAL_EVIDENCE` | claims de normalização/readiness da fase, não estado atual |
| `docs/phase-1` a `phase-4` | `HISTORICAL_EVIDENCE` | contratos de identidade, seleção e provenance; código é autoridade |
| `docs/dashboard-design.md` | `SUPERSEDED` | direção visual anterior; contém afirmações que antecedem Dashboard 2.0 |
| `apps/dashboard/DESIGN.md` | `LIVE_REFERENCE` | princípios visuais e UX; não é contrato de API |
| `docs/DASHBOARD-2-IMPLEMENTATION-PLAN.md` | `LIVE_REFERENCE` | mapa de capacidade/UX; endpoints e código vencem a tabela |
| `docs/autonomous-execution/*` | `LIVE_CANONICAL` | governança pós-MVP, readiness e handoff |

`AMBIGUOUS` deve ser usado no futuro quando a fonte não puder ser resolvida;
esta tabela não converte documento antigo em verdade atual.

## 2. Estado de implementação observado

### Proteções já presentes no código

- Compose operacional recebe `--project-name afiliado-shopee`.
- O supervisor valida identidade, volume PostgreSQL, ownership, portas,
  processos, lock e shutdown sem `down -v` no fluxo normal.
- `system:status` expõe project/volume sanitizados.
- O dashboard usa proxy same-origin com Authorization server-side.
- `OperationalAdminService` deriva blockers de grupo, campanha, assignment,
  quota, cooldown, pausa e disponibilidade.
- Scheduler comercial cria targets com `scheduleRevision`, `slotKey`,
  `scheduledFor`, grupo e uma instância sticky.
- Sender/worker/recovery preservam o contrato de attempt crítico e estado
  ambíguo sem retry automático.

### Limitações observadas

- O proxy usa padrões exatos; o cliente de Ofertas chama detalhe e preview que
  não estão cobertos por padrões equivalentes na allowlist observada.
- O schema/modelo atual tem apenas `WhatsAppDestination.assignedInstanceName`;
  não há coleção ordenada de N instâncias por grupo nem cursor derivado do slot.
- A instância é apresentada com health `UNKNOWN`; isso é seguro, mas a
  certificação de um heartbeat autoritativo ainda não existe.
- Os blockers são derivados e ricos, mas a causa dos grupos concretos do
  ambiente operacional não foi lida nesta missão documental.
- Browser smoke nas quatro larguras e quickstart autenticado pós-merge não
  possuem evidência atual nesta branch.

## 3. Gaps auditados

| ID | Classificação | Evidência | Leitura e próxima ação |
| --- | --- | --- | --- |
| GAP-01 | `PARTIALLY_FIXED` | `E30-CODE-001`, `E30-OP-001` | Fase 29 corrigiu identidade no código; falta smoke pós-merge de volume/restart em R1 |
| GAP-02 | `OPEN` | `E30-CODE-003` | completar allowlist/proxy de detalhe e preview sem abrir endpoints indevidos; R2 |
| GAP-03 | `PARTIALLY_FIXED` | `E30-CODE-005` | token/auth existem no supervisor/proxy; falta quickstart autenticado comprovado; R2 |
| GAP-04 | `PARTIALLY_FIXED` | `E30-CODE-004`, `E30-OP-001` | código deriva blockers; causa dos dados operacionais ainda precisa de leitura e correlação; R3 |
| GAP-05 | `REJECTED` como risco de falso online | `E30-CODE-004` | `UNKNOWN` é honesto sem heartbeat; não declarar conectado por registro DB. Um contrato de heartbeat futuro é melhoria separada |
| GAP-06 | `PARTIALLY_FIXED` | `E30-CODE-002` | um número pode ter muitos grupos via assignments, mas falta certificação operacional específica; R4 |
| GAP-07 | `OPEN` | `E30-CODE-002` | multi-instância no mesmo grupo por rotação de slot não é representado; R5 obrigatório |
| GAP-08 | `OPEN` | `E30-CODE-002` | UI atual expressa um número responsável, não ordem/estratégia N-sender; R6 |
| GAP-09 | `OPEN` | `E30-OP-001` | browser/Playwright não foi executado nesta missão; R7 deve produzir screenshots/traces ou BLOCKED |
| GAP-10 | `OPEN` | `E30-OP-001` | checklist final deve encadear start, banco canônico, preview, restart, recovery e SEND controlado; R8 |
| GAP-11 | `HUMAN_REQUIRED` | `E30-DOC-001` | retirar pause/ativar operação real jamais é inferido por um agente; R9 |

## 4. Invariantes do GAP-07

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

## 5. O que não foi afirmado

Não há nesta missão evidência atual de filas vazias, `paused`, health Docker,
Evolution conectada, browser HTTP, quotas ou providers. Esses estados devem ser
coletados em gates futuros; manter `UNVERIFIED` é deliberado.

Os nomes de status acima seguem exclusivamente o vocabulário de
`FINDING_LEDGER_SCHEMA.md`; não usar `CONFIRMED_OPEN`, `ALREADY_FIXED` ou
`HUMAN_DECISION_REQUIRED` como estados alternativos. O ledger inicial não
afirma que gaps foram corrigidos; fases futuras devem copiar os registros
relevantes para o manifesto da execução e acrescentar evidência nova.
