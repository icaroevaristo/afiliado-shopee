# Decision Log — Governança Pós-MVP

**Status:** `LIVE_CANONICAL`
**Escopo:** decisões estáveis desta arquitetura documental

| ID | Owner | Data | Decisão | Alternativas rejeitadas | Motivo/impacto | Evidência | Revisão | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D30-001 | Orchestrator | 2026-09-01 | Separar MVP `PROJECT_DONE` de `DAILY_USE_READY` | tratar como o mesmo gate | completude do MVP não prova readiness; impede ativação implícita | `E30-DOC-001` | R9 | vigente |
| D30-002 | Orchestrator | 2026-09-01 | `docs/PROJECT-ROADMAP.md` governa MVP; este pacote governa pós-MVP | duas fontes sem escopo | evita concorrência e torna claims explícitos | `E30-DOC-001` | quando roadmap mudar | vigente |
| D30-003 | Orchestrator | 2026-09-01 | Runtime operacional usa identidade Compose/volume canônica explícita | default derivado do cwd | bloqueia banco vazio alternativo | `E30-CODE-001` | R1 | vigente |
| D30-004 | Orchestrator | 2026-09-01 | Um Orchestrator integra mudanças e especialistas revisam READ_ONLY | mutators paralelos | uma autoridade para diff, findings e estado | `E30-DOC-002` | toda task P0/P1 | vigente |
| D30-005 | Orchestrator | 2026-09-01 | Rotação futura escolhe instância pelo slot, não por sucessos | cursor de sucesso/fallback | mantém determinismo e bloqueia reroute silencioso | `E30-CODE-002` | R5 | vigente |
| D30-006 | Orchestrator | 2026-09-01 | Health desconhecido permanece `UNKNOWN` | online por registro | evita falso online quando conexão não foi provada | `E30-CODE-004` | R3 | vigente |
| D30-007 | Orchestrator | 2026-09-01 | Nenhuma fase pós-MVP altera send boundary sem finding e especificação | refactor incidental do Sender | preserva contratos certificados e reduz blast radius | `E30-DOC-003` | R8 | vigente |
| D30-008 | Orchestrator | 2026-09-01 | Todo handoff usa manifesto versionado por contrato, sem secrets | handoff apenas narrativo | evita perda de estado/evidência entre agentes | `E30-DOC-004` | toda task | vigente |
| D30-009 | Orchestrator | 2026-09-01 | O estado operacional atual desta fase é `UNVERIFIED` | inferir runtime verde | a missão não autoriza runtime/DB/Redis; nenhum PASS é inventado | `E30-OP-001` | R1–R9 | vigente |
| D30-010 | SOL_SUPERVISOR | 2026-09-02 | `AUTO_CONTINUE` aceita mutation de código explicitamente autorizada quando reversível e cercada por gates | restringir toda mutation a docs/read-only | autonomia não deve parar por progresso; boundaries perigosos continuam bloqueados | `E30-DOC-008` | toda task | vigente |
| D30-011 | SOL_SUPERVISOR | 2026-09-02 | Sol supervisiona READ_ONLY e `LUNA_MAX` é o único mutator | Sol e especialistas editarem em paralelo | uma única autoridade de escrita preserva diff e finding ledger | `E30-DOC-008` | toda task | vigente |
| D30-012 | SOL_SUPERVISOR | 2026-09-02 | Reviews e ship gate são vinculados a `CANDIDATE_HEAD` + `CANDIDATE_TREE` congelados | aceitar aprovação de SHA antigo | mutation pós-freeze exige novo candidato e invalida evidência anterior | `E30-DOC-008` | toda task | vigente |
| D30-013 | SOL_SUPERVISOR | 2026-09-02 | E0–E10 em `PHASE_EXECUTION_PLAYBOOK.md` é o lifecycle documental LIVE_CANONICAL | checkpoints ad hoc por agente | owners, gates, recovery e saídas ficam auditáveis e não há parada por progresso | `E30-DOC-008` | R1–R9 | vigente |

## Regras para novas decisões

Uma decisão nova deve registrar autor/owner, data, escopo, alternativas
consideradas, evidência, efeito sobre invariantes e condição de revisão. Uma
decisão não pode conceder autorização que não esteja no pedido da task.

Decisões sobre volume, banco, pause, provider, custo, secrets ou SEND exigem
confirmação humana nomeada e não podem ser deduzidas deste arquivo.
