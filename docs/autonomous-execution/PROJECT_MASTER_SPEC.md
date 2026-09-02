# Afiliado Shopee — Project Master Spec pós-MVP

**Status:** `LIVE_CANONICAL` para a operação documental pós-MVP
**Atualizado:** 2026-09-01
**Baseline auditada:** `441c154650c808e496c3d9848f05e72ef40ddc95`

Este documento não substitui a certificação do MVP. `docs/PROJECT-ROADMAP.md`
continua sendo a fonte canônica do escopo e do status de `PHASES_1_TO_20` e
`MVP_PROJECT_DONE=true`. Este pacote governa somente o caminho entre o MVP já
certificado e `DAILY_USE_READY=true`.

## 1. Hierarquia de verdade

Quando fontes divergirem, aplicar esta ordem, distinguindo contrato de estado:

1. instruções de segurança do usuário, do repositório e do ambiente;
2. evidência live identificada por `EVIDENCE_ID` para fatos de estado (DB,
   volume, health, fila, processo e efeitos);
3. código e schema no `HEAD` auditado para contrato e capacidade atual;
4. `docs/PROJECT-ROADMAP.md` para o MVP e este pacote para o pós-MVP;
5. documentação histórica, relatórios e planos antigos.

Código não substitui uma leitura live de um estado stateful, e uma leitura
live não altera o contrato esperado pelo código. Se os dois não puderem ser
explicados juntos, o resultado é `AMBIGUOUS`/`HUMAN_REQUIRED`, não uma escolha
otimista.

Uma afirmação sem `EVIDENCE_ID` é `UNVERIFIED`. Um teste descrito mas não
executado não é PASS. Um resultado histórico não prova o estado atual.

## 2. Objetivo atual

O objetivo pós-MVP é permitir que o proprietário:

- ligue a instalação local com segurança;
- reconheça banco, volumes, Redis, Evolution, API, Dashboard e workers;
- opere normalmente pelo Dashboard;
- compreenda blockers e estados não confirmados;
- acompanhe agenda, quota, budget, routing e lifecycle;
- autorize qualquer SEND real de forma explícita;
- mantenha recuperação e idempotência fail-closed.

`DAILY_USE_READY` não é sinônimo de `PROJECT_DONE`. A ativação diária continua
sendo uma decisão humana explícita, mesmo depois de todos os gates técnicos.

## 3. Estado macro preservado

`PHASES_1_TO_20=DONE` e `MVP_PROJECT_DONE=true` permanecem históricos/canônicos
para o MVP. A Fase 20 registrou a cadeia agenda → seleção → provenance → copy →
draft → policy → dispatch/outbox → Evolution/WhatsApp → lifecycle terminal →
próximo ciclo, com múltiplos grupos e instâncias.

Isso não autoriza uma nova chamada externa. Nenhum agente pode interpretar
`PROJECT_DONE` como permissão para SEND, migration, seed ou ativação automática.

## 4. Arquitetura existente

| Camada | Responsabilidade | Autoridade atual |
| --- | --- | --- |
| `apps/dashboard` | Interface operacional e proxy same-origin | API existente; nunca Prisma/Redis/provider direto |
| `apps/api` | Fastify, serviços, rotas protegidas e composição | regras de domínio e contratos HTTP |
| `apps/worker` | consumers, Scheduler comercial, recovery e dispatch worker | lifecycle, filas e único boundary de envio |
| `packages/database` | Prisma, schema e migrations | persistência e CAS transacional |
| `packages/queue` | Redis/BullMQ e Scheduler | jobs determinísticos e estado de fila |
| `packages/providers` | Shopee, OpenAI, WhatsApp/Evolution e mocks | única borda externa por provider |
| `apps/system-supervisor` | Compose, ports, processos, readiness, start/stop | única autoridade de lifecycle local |
| `docker-compose.yml` | PostgreSQL e Redis principais | identidade Compose recebida explicitamente pelo supervisor |
| `infra/evolution` | stack Evolution isolada | projeto Compose separado e configuração local ignorada |

O supervisor usa `OPERATIONAL_COMPOSE_PROJECT_NAME=afiliado-shopee`, deriva o
volume `afiliado-shopee_postgres_data` e falha fechado quando a identidade ou o
volume não podem ser confirmados. Essa é uma proteção contra a regressão que
criou `phase17-gap-audit_postgres_data` em uma worktree anterior.

## 5. Modelo comercial principal

O fluxo persistido relaciona, sem reescrever histórico:

`ProductLead` → `CommercialOfferSnapshot` →
`CommercialPromotionCandidate` → `CommercialCopyGenerationAttempt` /
`GeneratedCopy` → `CommercialPipelineRun` → `WhatsAppDispatch` →
`CommercialDispatchOutbox` → delivery history.

`WhatsAppDestination` possui atualmente um `assignedInstanceName` sticky.
`WhatsAppInstance` possui vários destinos; o planner cria um target por grupo,
com `slotKey`, `scheduleRevision`, `scheduledFor`, `groupId` e `instanceName`.
O schema atual não representa uma lista ordenada de instâncias por grupo; isso é
o gap R5, não uma capacidade a presumir.

## 6. Invariantes mensuráveis

Todo gate futuro deve coletar os valores abaixo, ou declarar `UNKNOWN` com
`HUMAN_REQUIRED` quando a contagem não puder ser provada:

| Invariante | Valor exigido | Escopo |
| --- | ---: | --- |
| `DUPLICATE_SEND` | `0` | por destino, dispatch, job e janela |
| `SILENT_REROUTE` | `0` | grupo, instância, assignment e recovery |
| `UNAUTHORIZED_SEND` | `0` | qualquer provider de mensagem |
| `UNAUTHORIZED_PROVIDER_CALL` | `0` | Shopee, OpenAI e Evolution |
| `AMBIGUOUS_RESULT_RETRY` | `0` | depois de possível efeito externo |
| `SECRET_EXPOSURE` | `0` | logs, UI, args, env versionado e artifacts |
| `OPERATIONAL_VOLUME_DRIFT` | `0` | Compose project/volume canônicos |
| `HISTORICAL_LIFECYCLE_REWRITE` | `0` | executions, runs, dispatches e outboxes |
| `ACTIVE_SCHEDULER_COUNT` | `≤ 1` | perfil operacional |
| `ATTEMPT_COUNT_CRITICAL_MAX` | `1` | boundary provider |
| `PENDING_AMBIGUITY` | `0` | antes de iniciar nova operação |
| `PENDING_INVESTIGATION` | `0` | antes de declarar readiness |
| `COST_BUDGET_OVERRUN` | `0` | budgets externos do dia |
| `AUTH_BYPASS` | `0` | control plane local |

## 7. Boundaries de envio

Existe um único caminho autorizado para publicação comercial: candidate/copy
certificados → dispatch/outbox → `SenderService` → provider selecionado. Manual
publication deve reutilizar esse caminho. O Scheduler não chama provider e o
Dashboard não chama provider. Mocks, previews e diagnósticos não são SENDs.

Evolution deve distinguir bloqueio pré-request de resultado em que o request
pode ter começado. Timeout, reset, HTTP ou falha de persistência após o início
conservam estado ambíguo/`PROCESSING` e exigem investigação; nunca autorizam
retry automático.

## 8. Ambientes

| Classe | Uso | Regra de isolamento |
| --- | --- | --- |
| `LOCAL_OPERATIONAL` | instalação do proprietário | Compose/volume canônicos; sem ação destrutiva automática |
| `LOCAL_ISOLATED` | worktree ou preview explicitamente isolado | project name, volumes e Evolution dedicados; nunca tocar stack operacional |
| `TEST` | unit/integration | mocks ou DB/Redis descartáveis; sem secrets operacionais |
| `CI` | regressão remota | providers bloqueados e ambiente mínimo explícito |
| `PRODUCTION_FUTURE` | fora do escopo atual | exige especificação e gates próprios |

`LOCAL` não significa descartável. `docker compose down -v`, `migrate reset`,
`db push`, seed operacional, remoção de volume e recuperação de dados reais são
`HUMAN_REQUIRED` ou proibidos conforme a tarefa.

## 9. Custo e orçamento

Mensagem, Shopee HTTP, OpenAI generation, Evolution HTTP e qualquer serviço
pago são categorias separadas de custo/efeito. Uma task deve declarar limites
por categoria, registrar claims antes do provider quando o contrato exigir e
usar cache sem consumir geração. Falha, timeout ou output inválido contam como
tentativa externa quando o provider já foi chamado.

O handoff deve atualizar um `MONTHLY_COST_LEDGER` sanitizado com período,
categoria, owner, budget autorizado, uso observado e `UNKNOWN` quando não for
possível medir. Nenhum agente pode introduzir assinatura, serviço pago,
telemetria paga ou recorrência nova sem autorização humana explícita. Um limite
de mensagens não substitui um limite de custo externo.

O registro mínimo do ledger é
`{month, category, authorizedBudget, observedUsage, currency, newRecurringCost,
owner, evidenceIds, status}`. Categorias devem separar mensagens, Shopee,
OpenAI, Evolution, infraestrutura e qualquer serviço pago. `status=UNKNOWN`
exige blocker ou decisão humana; não é uma forma de zerar consumo.

## 10. Não objetivos

Não fazem parte deste caminho sem decisão nova: SaaS multiusuário, billing,
app mobile nativo, HA geográfico, RBAC complexo, outros marketplaces, A/B
automático de copy, invite link, QR/login de novas instâncias, Flash Deals sem
sinal oficial, mini-scheduler manual e qualquer segundo send boundary.

## 11. Evidência desta auditoria

- `E30-BASE-001`: Git foi revalidado antes da branch; `HEAD` e `origin/main`
  observados em `441c154650c808e496c3d9848f05e72ef40ddc95`, com worktree
  limpa no instante do baseline. A alteração documental posterior é o
  target da branch e está coberta por `E30-DOC-006`.
- `E30-CODE-001`: `runtime-identity.ts`, `supervisor.ts`, `runtime tests` e
  `README.md` mostram project/volume explícitos e fail-closed.
- `E30-CODE-002`: planner e schema mostram target com uma instância sticky por
  grupo; não há contrato de rotação N-instâncias por grupo.
- `E30-CODE-003`: proxy do Dashboard usa allowlist exata; o cliente chama
  detalhe e preview de Ofertas que não aparecem como padrões autorizados
  equivalentes.
- `E30-CODE-004`: `OperationalAdminService` deriva blockers e expõe health
  `UNKNOWN`; disponibilidade e health não são tratados como a mesma coisa.
- `E30-CODE-005`: o proxy same-origin do Dashboard injeta a autorização
  server-side a partir do ambiente local e restringe destinos por allowlist;
  a existência do mecanismo não equivale a uma prova de quickstart
  autenticado no ambiente operacional.
- `E30-OP-001`: smoke operacional pós-MVP não foi executado nesta missão
  documental; readiness atual, filas e providers são `UNVERIFIED`.
