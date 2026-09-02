# Risk Register — Operação Autônoma Pós-MVP

**Status:** `LIVE_CANONICAL`
**Escala:** `PROBABILITY` e `IMPACT` usam `LOW`, `MEDIUM` ou `HIGH`.
`STATUS` só pode ser `OPEN`, `MITIGATED`, `ACCEPTED` ou `HUMAN_REQUIRED`.
Nenhum risco é fechado apenas por existir código.

| RISK_ID | DESCRIPTION | PROBABILITY | IMPACT | MITIGATION | DETECTION | OWNER | STATUS | EVIDENCE |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R30-001 | checkout seleciona Compose/volume errado e abre banco vazio | MEDIUM | HIGH | identidade canônica explícita, inspect e fail-closed | status + volume metadata | runtime/data | OPEN | E30-CODE-001 |
| R30-002 | migration aplicada no banco errado ou sem histórico íntegro | LOW | HIGH | database identity, pending list única e READ_ONLY precheck | migrate status + DB metadata | SQL specialist | OPEN | E30-OP-001 |
| R30-003 | dois schedulers criam slots/jobs duplicados | MEDIUM | HIGH | owner/lease, scheduler count ≤1 e job IDs determinísticos | status, Redis e logs | scheduler | OPEN | E30-CODE-001 |
| R30-004 | assignment muda depois de job aceito e reroute grupo/instância | MEDIUM | HIGH | revision/acceptance boundary e sticky provenance | payload, rows, lifecycle | routing | OPEN | E30-CODE-002 |
| R30-005 | rotação N-instâncias deriva após restart/replan | HIGH | HIGH | binding por slot, lista ordenada, revision e sem fallback | comparação de slot plans | scheduler/data | OPEN | E30-CODE-002 |
| R30-006 | target stale chega ao orchestrator | MEDIUM | HIGH | schedule revision validada antes do lifecycle | stale job test | scheduler | OPEN | E30-CODE-002 |
| R30-007 | dispatch/outbox/job duplicado alcança provider | LOW | HIGH | unique/deterministic IDs, CAS e recovery conservador | lifecycle reconciliation | backend/DB | OPEN | E30-OP-001 |
| R30-008 | timeout/resultado incerto é repetido | LOW | HIGH | `PROCESSING`/ambiguity terminal, retry zero | attempt/effect ledger | sender | OPEN | E30-OP-001 |
| R30-009 | Evolution indisponível é exibida como saudável | MEDIUM | HIGH | health `UNKNOWN`, readiness distinta de process alive | status/readiness | observability | MITIGATED | E30-CODE-004 |
| R30-010 | provider externo chamado antes de gates baratos | MEDIUM | HIGH | target, provenance, copy, quota, budget e safe mode antes da borda | counters + call mocks | backend/QA | OPEN | E30-CODE-001 |
| R30-011 | loops de falha consomem Shopee/OpenAI sem limite | MEDIUM | HIGH | budget diário atômico e cache sem claim | usage ledger | cost owner | OPEN | E30-CODE-001 |
| R30-012 | segredo aparece em log, UI, args, artifact ou teste | MEDIUM | HIGH | env isolation, redaction e secret scans | marker/fake secret tests | security | OPEN | E30-CODE-005 |
| R30-013 | proxy não autoriza endpoint usado pela UI | HIGH | MEDIUM | allowlist derivada de call sites e teste de cada rota | API/proxy contract test | API | OPEN | E30-CODE-003 |
| R30-014 | auth/control plane quebrado é confundido com health | MEDIUM | HIGH | readiness autenticada e 401/403 explícitos | protected probe | API | OPEN | E30-CODE-005 |
| R30-015 | Dashboard mostra online com dados stale ou blocker oculto | MEDIUM | MEDIUM | fonte/timestamp/blocker explícitos; `UNKNOWN` honesto | browser/status tests | observability | OPEN | E30-CODE-004 |
| R30-016 | browser smoke ausente gera falso PASS visual | MEDIUM | MEDIUM | evidência por viewport/trace ou `BLOCKED` | browser artifact check | QA | OPEN | E30-OP-001 |
| R30-017 | docs antigas reativam comando proibido ou status falso | MEDIUM | HIGH | classificação documental e precedência explícita | doc red-team | Orchestrator | MITIGATED | E30-DOC-001 |
| R30-018 | agente futuro perde finding e repete investigação perigosa | MEDIUM | HIGH | finding ledger, manifest e handoff obrigatório | schema validation | Orchestrator | MITIGATED | E30-DOC-004 |
| R30-019 | mutators concorrentes alteram o mesmo estado | MEDIUM | HIGH | single integrator e locks por estadoful component | branch/process audit | Orchestrator | MITIGATED | E30-DOC-002 |
| R30-020 | custo pago novo é introduzido por dependência/serviço | LOW | HIGH | cost policy e monthly ledger; HUMAN_REQUIRED | dependency/billing review | owner | OPEN | E30-DOC-005 |
| R30-021 | readiness passa em banco/volume operacional não identificado | LOW | HIGH | identidade DB/volume obrigatória antes de start | sanitized metadata | runtime/data | OPEN | E30-OP-001 |
| R30-022 | group/instance indisponível gera fallback silencioso | MEDIUM | HIGH | slot binding e bloqueio explícito | target + assignment comparison | routing | OPEN | E30-CODE-002 |
| R30-023 | falha parcial de start deixa API/worker órfão | MEDIUM | HIGH | ordem, ownership, rollback e status final | supervisor failure matrix | runtime | OPEN | E30-CODE-001 |
| R30-024 | dados comerciais históricos são reescritos durante recovery | LOW | HIGH | recovery sem cleanup histórico e invariants | before/after row counts/IDs | DB | OPEN | E30-OP-001 |

## Uso operacional

Cada fase deve referenciar os riscos que toca e registrar detecção real no seu
manifesto. `MITIGATED IN CODE` significa somente que existe uma proteção
observada; não substitui a prova operacional exigida pelo gate. Risco com
probabilidade baixa e impacto alto continua sendo gate obrigatório.

Um risco vira `HUMAN_REQUIRED` quando a decisão não pode ser tomada com
segurança pelo agente, por exemplo identidade ambígua do banco, segredo
conflitante, custo pago ou efeito externo incerto.
