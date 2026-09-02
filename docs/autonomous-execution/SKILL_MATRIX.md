# Skill Matrix — Execução Autônoma Pós-MVP

**Status:** `LIVE_CANONICAL`
**Regra:** usar o mínimo de contexto que cobre o blast radius; não declarar
skill carregada sem path real.

## Governança de agentes

| Papel | Estado | Regra operacional |
| --- | --- | --- |
| `SOL_SUPERVISOR` | `READ_ONLY=true` | congela scope/candidato, valida gates, reconcilia estado e decide SHIP/FIX_FIRST; não edita |
| `LUNA_MAX` | `SINGLE_MUTATOR=true` | único agente que implementa, testa causalmente e prepara a candidate |
| `REVIEWER_A` | `READ_ONLY=true` | revisa somente o `CANDIDATE_HEAD`/`CANDIDATE_TREE` recebido |
| `REVIEWER_B` | `READ_ONLY=true` | revisa somente o snapshot exato recebido |
| `FINAL_ADVERSARIAL` | `READ_ONLY=true` | tenta provar que a candidate não deve passar; não corrige |

Qualquer mutation depois de `CANDIDATE_FROZEN=true` exige novo candidato e
invalida aprovações do snapshot anterior.

## Skills carregadas nesta Fase 30

| Skill | Path real | Aplicação nesta fase |
| --- | --- | --- |
| `shopee-goal-guard` | `C:\Users\T-Gamer\.codex\skills\shopee-goal-guard\SKILL.md` | objetivo, escopo documental, invariantes e segurança |
| `safe-command-architect` | `C:\Users\T-Gamer\.codex\skills\safe-command-architect\SKILL.md` | baseline Git, comandos não destrutivos e zero efeitos operacionais |
| `shopee-git-worktree-manager` | `C:\Users\T-Gamer\.codex\skills\shopee-git-worktree-manager\SKILL.md` | branch a partir de `origin/main`, preservação de WIP e diff |
| `shopee-code-reviewer` | `C:\Users\T-Gamer\.codex\skills\shopee-code-reviewer\SKILL.md` | critério de revisão independente P0/P1/P2 |
| `shopee-ship-gate` | `C:\Users\T-Gamer\.codex\skills\shopee-ship-gate\SKILL.md` | gate de escopo, evidência, segurança e Git |
| `shopee-env-secrets-manager` | `C:\Users\T-Gamer\.codex\skills\shopee-env-secrets-manager\SKILL.md` | política de presença/ausência sem imprimir secrets |
| `shopee-senior-backend` | `C:\Users\T-Gamer\.codex\skills\shopee-senior-backend\SKILL.md` | call graph da API, workers e lifecycle |
| `shopee-sql-database-assistant` | `C:\Users\T-Gamer\.codex\skills\shopee-sql-database-assistant\SKILL.md` | Prisma, CAS, volume, migrations e DB read-only |
| `shopee-senior-qa` | `C:\Users\T-Gamer\.codex\skills\shopee-senior-qa\SKILL.md` | matriz de testes, concorrência, recovery e no-SEND |
| `shopee-api-design-reviewer` | `C:\Users\T-Gamer\.codex\skills\shopee-api-design-reviewer\SKILL.md` | allowlist/proxy, auth e contratos de API |
| `shopee-observability-designer` | `C:\Users\T-Gamer\.codex\skills\shopee-observability-designer\SKILL.md` | blockers, evidence IDs, budgets e status sanitizado |

**E30-SKILL-001:** catálogo runtime e leitura integral dos paths acima foram
realizados antes da mutação documental. Nenhuma skill obrigatória ficou
indisponível.

## Matriz para fases futuras

| Fase | Agente | Required skills | Optional skills | Proibido/redundante | Gate mínimo |
| --- | --- | --- | --- | --- | --- |
| R1 runtime canônico | runtime/data sob SOL_SUPERVISOR | goal-guard, safe-command, git, backend, SQL, QA, ship | observability | iniciar outra worktree/volume; cleanup amplo | identidade/volume/restart comprovados |
| R2 API/proxy/auth | API | goal-guard, safe-command, API reviewer, backend, QA, secrets | observability | endpoint genérico; token no browser | rotas usadas pela UI e quickstart autenticado |
| R3 status/health | observability/backend | goal-guard, backend, observability, QA | API reviewer | inventar online; mascarar blocker | `UNKNOWN`/indisponível explicáveis |
| R4 um número/muitos grupos | routing | goal-guard, backend, SQL, QA | observability | fanout, loop, reroute | assignments, stagger, quota e dedupe |
| R5 N números/um grupo | scheduler/data | goal-guard, backend, SQL, QA, API reviewer | observability | contador de sucesso como cursor; fallback | N=1,2,3+, restart/replan e slot binding |
| R6 UX rotação | frontend/API | goal-guard, API reviewer, QA, observability | frontend/design | estado local substituindo backend | assignment/rotation visual e CAS |
| R7 offline/browser | QA/frontend | goal-guard, QA, secrets, ship | browser/webapp-testing | PASS sem execução visual | matriz 390/768/1024/1440 |
| R8 SEND controlado | runtime/data/security sob SOL_SUPERVISOR | todas as hard guards, backend, SQL, QA, secrets, observability, ship | API reviewer | provider sem autorização; retry incerto | autorização, budget, receipt e lifecycle |
| R9 ativação diária | SOL_SUPERVISOR + owner | goal-guard, safe-command, secrets, observability, ship | reviewer | remover pause automaticamente | decisão humana registrada |

## Skills não carregadas por não serem necessárias

Nenhuma skill obrigatória esteve indisponível. Skills genéricas de frontend,
browser, Vercel e pesquisa externa não foram carregadas: esta tarefa não alterou
UI, não executou browser smoke e não exigiu fonte externa. Isso evita contexto
redundante e não representa aprovação desses domínios.
