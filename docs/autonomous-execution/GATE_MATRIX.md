# Gate Matrix — Execução e Readiness

**Status:** `LIVE_CANONICAL`
**Estados permitidos:** `PASS`, `FAIL`, `BLOCKED`, `HUMAN_REQUIRED`,
`NOT_RUN`.

`PASS` requer `EVIDENCE_ID` específico. Código, intenção, dashboard verde ou
uma mensagem de agente não são evidência suficientes para gates operacionais.

| GATE_ID | Gate | Precondições | Evidência mínima | Estado nesta fase | Blocker/saída |
| --- | --- | --- | --- | --- | --- |
| G30-001 | Baseline Git | remote e worktree conhecidas | `E30-BASE-001` | PASS | diverge → HUMAN_REQUIRED |
| G30-002 | Escopo docs-only | branch dedicada | `E30-DOC-006` | PASS | código → parar; validar antes do ship |
| G30-003 | Hierarquia documental | fontes classificadas | `E30-DOC-001` | PASS | conflito irresolúvel → HUMAN_REQUIRED |
| G30-004 | Skills | paths reais lidos | `E30-SKILL-001` | PASS | skill hard missing → HUMAN_REQUIRED |
| G30-005 | Evidence contract | schema definido | `E30-DOC-006` | PASS | evidence ausente → NOT_RUN/BLOCKED; claim → UNVERIFIED |
| G30-006 | Red-team documental | artefatos completos | `E30-REDTEAM-001` | PASS | P0/P1 → reparar e repetir |
| G30-007 | Sol independente | review sem viés | `E30-SOL-001` | PASS | P0/P1 → reparar e repetir |
| G30-008 | Ship docs | gates docs, secret scan | `E30-SHIP-001` | PASS | qualquer P0/P1 → FAIL |
| R1-001 | identidade Compose | runtime profile explícito | status/inspect sanitizado | NOT_RUN | ambígua → HUMAN_REQUIRED |
| R1-002 | volume canônico | volume existe e é esperado | Docker inspect + DB identity | NOT_RUN | ausente → DO_NOT_START |
| R1-003 | restart/stop | runtime autorizado | before/after process/volume | NOT_RUN | drift → FAIL |
| R1-004 | isolamento teste | perfil isolado explícito | nomes/volumes separados | NOT_RUN | compartilhamento → FAIL |
| R1-005 | scheduler singleton e restart | identidade/lock do projeto | count, owner, registration e restart sem duplicação | NOT_RUN | duplicate/churn → FAIL |
| R2-001 | proxy allowlist | call sites mapeados | cada path/método testado | NOT_RUN | path sem regra → FAIL |
| R2-002 | auth control plane | token não vazio | protected request 2xx/401/403 | NOT_RUN | health-only → NOT_READY |
| R2-003 | CAS de mutações | revision observada | stale write 409 e estado preservado | NOT_RUN | overwrite → FAIL |
| R3-001 | status/readiness | fontes definidas | snapshot sanitizado por componente | NOT_RUN | falso online → FAIL |
| R3-002 | blockers | regras correlacionadas | blockers com causa e timestamp | NOT_RUN | blocker oculto → FAIL |
| R4-001 | um→muitos assignments | vários grupos reais/test fixture | rows, slots, lifecycle | NOT_RUN | fanout/reroute → FAIL |
| R4-002 | reassign safety | lifecycle concorrente | interleaving/rejection | NOT_RUN | TOCTOU → FAIL |
| R5-001 | lista ordenada N→1 | modelo e revision | assignment list + unique/CAS | NOT_RUN | sem autoridade → BLOCKED |
| R5-002 | slot binding | agenda gerada | instance por slot antes enqueue/send | NOT_RUN | seleção tardia → FAIL |
| R5-003 | restart/replan | mesmo input/revision | drift comparison zero | NOT_RUN | drift → FAIL |
| R5-004 | indisponibilidade | slot vinculado | bloqueio sem fallback | NOT_RUN | reroute → FAIL |
| R6-001 | UX rotation | API R5 PASS | browser trace + 409 handling | NOT_RUN | UI diverge → FAIL |
| R7-001 | offline/browser | build canônico | screenshots/traces 390/768/1024/1440 | NOT_RUN | sem browser → BLOCKED |
| R7-002 | secrets frontend | env map | scan HTML/JS/storage/URL | NOT_RUN | secret → FAIL |
| R8-001 | authorization | owner approval | authorization + budget manifest | NOT_RUN | missing → HUMAN_REQUIRED |
| R8-002 | no duplicate/ambiguity | provider guard | effect ledger + lifecycle | NOT_RUN | ambiguity → HUMAN_REQUIRED |
| R8-003 | terminal recovery | crash matrix | DB/queue/recovery evidence | NOT_RUN | unknown state → HUMAN_REQUIRED |
| R9-001 | daily owner decision | R1–R8 PASS | signed/recorded decision | NOT_RUN | no decision → HUMAN_REQUIRED |
| R9-002 | paused safety | explicit pause authority | pause before/after start | NOT_RUN | unpause implicit → FAIL |

## Regra de decisão

Gates que não se aplicam devem registrar `NOT_RUN` com justificativa, não
`PASS`. `BLOCKED` preserva o impedimento; `HUMAN_REQUIRED` significa que uma
decisão/autoridade externa é necessária. A fase só avança quando todas as
precondições do próximo gate estão cumpridas e nenhuma evidência contradiz um
invariante.
