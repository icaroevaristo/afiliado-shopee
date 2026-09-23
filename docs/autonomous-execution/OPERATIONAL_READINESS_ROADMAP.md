# Roadmap de Readiness Operacional Pós-MVP

**Status:** `LIVE_CANONICAL`
**Escopo:** caminho entre `MVP_PROJECT_DONE=true` e uma decisão humana de
`DAILY_USE_READY=true`
**Regra:** este roadmap organiza trabalho futuro; não autoriza runtime,
migration, provider, SEND ou remoção da pausa.

## Como usar

`docs/PROJECT-ROADMAP.md` continua sendo a fonte do MVP. Este arquivo é a
fonte do roadmap pós-MVP. Cada fase deve criar um manifesto de execução e
registrar evidência antes de mudar seu estado. Os únicos estados permitidos
são `NOT_RUN`, `IN_PROGRESS`, `PASS`, `FAIL`, `BLOCKED` e
`HUMAN_REQUIRED`.

Uma fase não pode ser marcada como `PASS` por inspeção estática quando seu
critério exige teste, browser, banco, fila ou provider. O próximo passo não
herda autorização da fase anterior. O lifecycle documental de cada R1–R9 é o
`PHASE_EXECUTION_PLAYBOOK.md`, com E0–E10, `SOL_SUPERVISOR` READ_ONLY e
`LUNA_MAX` como único mutator.

## Fases planejadas

| Fase | Objetivo | Owner lógico | Estado inicial | Próxima fase |
| --- | --- | --- | --- | --- |
| R1 | Certificar runtime, volume e restart canônicos pós-merge | runtime/data | `NOT_RUN` | R2 |
| R2 | Fechar proxy, auth e quickstart usados pelo Dashboard | API/control-plane | `NOT_RUN` | R3 |
| R3 | Tornar status, health e blockers operacionalmente verificáveis | observability/runtime | `NOT_RUN` | R4 |
| R4 | Certificar um número atribuído a vários grupos | routing | `NOT_RUN` | R5 |
| R5 | Certificar N instâncias para um grupo com rotação determinística | scheduler/data | `NOT_RUN` | R6 |
| R6 | Expor administração segura da rotação no Dashboard | UX/API | `NOT_RUN` | R7 |
| R7 | Validar browser, offline, responsividade e recuperação da UI | QA/frontend | `NOT_RUN` | R8 |
| R8 | Executar SEND controlado sob autorização independente | runtime/security | `NOT_RUN` | R9 |
| R9 | Decidir ativação diária e retirada da pausa | proprietário | `NOT_RUN` | encerramento |

## Contrato de cada fase

### R1 — Runtime canônico pós-merge

- **OBJECTIVE:** provar que qualquer checkout operacional explicitamente
  autorizado usa `OPERATIONAL_COMPOSE_PROJECT=afiliado-shopee`, o volume
  canônico e a mesma identidade após restart.
- **INPUTS:** `runtime-identity.ts`, supervisor, Compose, Docker inspect,
  estado do banco e manifesto anterior.
- **OWNER:** runtime/data specialist sob o `SOL_SUPERVISOR`.
- **SKILLS:** goal guard, safe command, git/worktree, backend, SQL, QA,
  observability e ship gate.
- **EXPECTED_COMPONENTS:** `system:status`, `system:start`, `system:stop`,
  Compose project/volume, lock e readiness.
- **INVARIANTS:** não criar banco vazio alternativo; stop não remove volume;
  `OPERATIONAL_VOLUME_DRIFT=0`; no provider; pausa preservada.
- **TESTS:** duas worktrees no mesmo perfil operacional, dois perfis isolados,
  restart, volume ausente/ambíguo, processo externo e rollback parcial.
- **EVIDENCE:** Git SHA, `system:status --json` sanitizado, Docker inspect,
  comandos/exit codes e manifesto de estado.
- **GATES:** identidade e volume provados; qualquer ambiguidade é
  `HUMAN_REQUIRED`.
- **RECOVERY:** parar antes de criar infraestrutura alternativa; não copiar,
  renomear ou remover volumes automaticamente.
- **DONE_CRITERIA:** todos os testes críticos passam, nenhum P0/P1 e revisão
  independente itemizada.
- **NEXT_PHASE:** R2 somente após evidência de R1.

### R2 — API, proxy e auth

- **OBJECTIVE:** provar que cada ação exibida pelo Dashboard chega a uma rota
  allowlisted, autenticada e compatível, sem endpoint genérico.
- **INPUTS:** rotas Fastify, proxy same-origin, cliente do Dashboard,
  `LOCAL_API_AUTH_TOKEN` e contratos de erro.
- **OWNER:** API/control-plane specialist.
- **SKILLS:** API reviewer, backend, secrets, QA, observability e ship gate.
- **EXPECTED_COMPONENTS:** detalhe/preview de ofertas, readiness autenticada,
  401/403/409 estáveis e proxy server-side.
- **INVARIANTS:** token nunca no browser; `AUTH_BYPASS=0`; método/path
  allowlist explícitos; sem segredo em resposta ou log.
- **TESTS:** rota usada pela UI, token ausente/incorreto/correto, CAS,
  double-submit e API offline.
- **EVIDENCE:** testes com fixtures fake, resposta sanitizada, diff da
  allowlist e trace de browser quando exigido.
- **GATES:** health público sozinho não é readiness; quickstart autenticado
  deve passar.
- **RECOVERY:** rejeitar a ação e preservar estado quando auth ou CAS falhar;
  não reenviar automaticamente.
- **DONE_CRITERIA:** todas as ações operacionais têm contrato verificado e
  não há P0/P1.
- **NEXT_PHASE:** R3.

### R3 — Status, health e blockers

- **OBJECTIVE:** distinguir processo vivo, serviço pronto, control plane
  autenticado, provider configurado e instância conectada.
- **INPUTS:** supervisor, API, OperationalAdminService, filas e fontes de
  health existentes.
- **OWNER:** observability/runtime specialist.
- **SKILLS:** observability, backend, API reviewer, QA e secrets.
- **EXPECTED_COMPONENTS:** snapshot sanitizado, blockers, readiness e
  Dashboard de Sistema.
- **INVARIANTS:** `UNKNOWN` permanece `UNKNOWN`; não converter registro
  persistido em online; contagens não podem ser inventadas.
- **TESTS:** health parcial, API sem auth, worker ausente, Evolution parcial,
  fila degradada e dados stale.
- **EVIDENCE:** snapshots sanitizados, timestamps/timezone, testes de estado e
  trace de UI.
- **GATES:** nenhuma tela pode declarar pronto com blocker desconhecido.
- **RECOVERY:** mostrar blocker acionável e impedir a ação dependente; não
  iniciar provider para descobrir readiness.
- **DONE_CRITERIA:** cada estado mostrado tem fonte e semântica documentadas.
- **NEXT_PHASE:** R4.

### R4 — Um número para vários grupos

- **OBJECTIVE:** provar assignments reais de um número para vários grupos sem
  fanout acidental, perda de sticky routing ou divergência de quota.
- **INPUTS:** `WhatsAppDestination`, `WhatsAppInstance`, planner, assignment,
  dispatch e UI.
- **OWNER:** routing specialist.
- **SKILLS:** backend, SQL, QA, observability e API reviewer.
- **EXPECTED_COMPONENTS:** assignments, stagger, quota por grupo e dedupe.
- **INVARIANTS:** destino não troca de instância silenciosamente;
  `DUPLICATE_SEND=0`; um slot tem um grupo; reassign bloqueia lifecycle ativo.
- **TESTS:** dois ou mais grupos, ordem dos slots, pausa de um grupo,
  assignment concorrente e restart.
- **EVIDENCE:** linhas persistidas, slot/job IDs, lifecycle completo e testes
  determinísticos sem provider real quando não autorizado.
- **GATES:** qualquer reroute ou estado incerto bloqueia a fase.
- **RECOVERY:** preservar assignment e falhar fechado; não converter contador
  em autorização de fanout.
- **DONE_CRITERIA:** um número/muitos grupos é comprovado ponta a ponta.
- **NEXT_PHASE:** R5.

### R5 — N instâncias para um grupo

- **OBJECTIVE:** introduzir, se aprovado por especificação própria, uma lista
  ordenada de instâncias por grupo com escolha determinada pelo slot.
- **INPUTS:** modelo de assignment, scheduler, revision, recovery e
  disponibilidade.
- **OWNER:** scheduler/data specialist.
- **SKILLS:** backend, SQL, QA, API reviewer e observability.
- **EXPECTED_COMPONENTS:** lista ordenada, revision, `slotKey`, binding antes
  do enqueue e validação antes do SEND.
- **INVARIANTS:** escolha não depende do número de sucessos; restart/replan não
  muda a rotação; instância indisponível bloqueia o slot; fallback silencioso
  é zero.
- **TESTS:** N=1, N=2, N=3+, restart, replan, processo concorrente,
  indisponibilidade e assignment stale.
- **EVIDENCE:** tabela de slots, assignment revision, job payload sanitizado,
  interleavings reproduzíveis e, somente com autorização futura, receipt de
  provider.
- **GATES:** nenhuma implementação deve ser aprovada só por uma lista visual
  ou por testes unitários sem persistência/concorrência.
- **RECOVERY:** manter a instância já vinculada; não deslocar para a próxima
  saudável sem decisão explícita.
- **DONE_CRITERIA:** `RESTART_ROTATION_DRIFT=0`, `REPLAN_ROTATION_DRIFT=0` e
  nenhuma chamada para instância errada.
- **NEXT_PHASE:** R6.

### R6 — UX de rotação

- **OBJECTIVE:** tornar assignments/ordem/estado compreensíveis e seguros no
  Dashboard.
- **INPUTS:** contrato R5, CAS, blockers e rotas existentes.
- **OWNER:** UX/API specialist.
- **SKILLS:** API reviewer, QA, observability, frontend quando disponível e
  secrets.
- **EXPECTED_COMPONENTS:** edição explícita, confirmação, revision e
  bloqueio de lifecycle.
- **INVARIANTS:** UI não substitui a autoridade do backend; erro 409 não é
  escondido; seleção não cria campo contador divergente.
- **TESTS:** dois browsers, refresh durante mutation, assignment ativo,
  mobile/desktop e estado offline.
- **EVIDENCE:** screenshots/traces, responses sanitizadas e testes de contrato.
- **GATES:** nenhuma ação sem endpoint e autorização correspondente.
- **RECOVERY:** atualizar estado e pedir confirmação novamente; não repetir
  mutation automaticamente.
- **DONE_CRITERIA:** UX representa o modelo real sem affordance insegura.
- **NEXT_PHASE:** R7.

### R7 — Offline/browser

- **OBJECTIVE:** validar a experiência real sem confundir UI bonita com
  disponibilidade operacional.
- **INPUTS:** Dashboard canônico, API/proxy, estados de erro e design atual.
- **OWNER:** QA/frontend specialist.
- **SKILLS:** senior QA, browser/webapp testing se disponível, secrets,
  observability e ship gate.
- **EXPECTED_COMPONENTS:** visões de início, ofertas, grupos, WhatsApps,
  automação, histórico, configurações e diagnóstico.
- **INVARIANTS:** erro/offline é explícito; nenhum segredo no HTML, URL,
  storage ou screenshot; ações perigosas exigem confirmação.
- **TESTS:** 390, 768, 1024 e 1440px; API offline; loading; empty; retry;
  navegação e keyboard.
- **EVIDENCE:** screenshots, browser trace e comandos com exit code.
- **GATES:** sem evidência visual a fase é `NOT_RUN`/`BLOCKED`, não PASS.
- **RECOVERY:** manter estado seguro e oferecer retry manual bounded.
- **DONE_CRITERIA:** matriz visual e funcional aprovada, sem P0/P1.
- **NEXT_PHASE:** R8.

### R8 — SEND controlado

- **OBJECTIVE:** provar um caminho comercial real, com autorização, budget,
  destination/instance explícitas e lifecycle terminal.
- **INPUTS:** todas as fases anteriores, provider configurado, banco/volume
  canônicos e autorização do proprietário.
- **OWNER:** `SOL_SUPERVISOR` com runtime/data/security specialists.
- **SKILLS:** todas as hard guards, backend, SQL, QA, secrets,
  observability, code reviewer e ship gate.
- **EXPECTED_COMPONENTS:** manifesto de budget/effects, target autorizado,
  dispatch/outbox, receipt e recovery.
- **INVARIANTS:** sem retry de resultado incerto; `DUPLICATE_SEND=0`;
  `SILENT_REROUTE=0`; attempt crítico máximo 1; nenhum quinto efeito.
- **TESTS:** primeiro somente mocks; depois smoke explicitamente autorizado,
  com hard cap e abort gates.
- **EVIDENCE:** autorização, contadores before/after, logs sanitizados,
  lifecycle e receipt quando permitido.
- **GATES:** qualquer ambiguity, target fora da lista ou budget incerto é
  `HUMAN_REQUIRED`.
- **RECOVERY:** parar produção, preservar evidência e não repetir o SEND.
- **DONE_CRITERIA:** prova mínima prevista na autorização e review adversarial
  independente.
- **NEXT_PHASE:** R9.

### R9 — Ativação diária

- **OBJECTIVE:** decidir se o proprietário quer remover a pausa e operar
  diariamente.
- **INPUTS:** R1–R8, documentação atual, custos, blockers e decisão humana.
- **OWNER:** proprietário; agentes apenas apresentam evidência.
- **SKILLS:** goal guard, safe command, secrets, observability, ship gate e
  code reviewer.
- **EXPECTED_COMPONENTS:** checklist final, plano de rollback seguro,
  runtime/profile, treinamento curto e janela de observação.
- **INVARIANTS:** `paused=true` até decisão; não ativar por conveniência;
  custos e provider devem estar autorizados; operação diária não é inferida
  de `PROJECT_DONE`.
- **TESTS:** start/stop, pausa, readiness, quotas, blockers, restart e
  observação sem SEND antes da ativação.
- **EVIDENCE:** manifesto final, confirmação humana e review independente.
- **GATES:** todos os gates técnicos PASS, P0/P1 zero e owner decision
  registrada.
- **RECOVERY:** manter pausa, parar sistema com supervisor e preservar estado.
- **DONE_CRITERIA:** `DAILY_USE_READY=true` somente com predicado completo e
  decisão humana explícita.
- **NEXT_PHASE:** operação mantida sob monitoramento; mudanças retornam ao
  roadmap.

## Proibição de microtarefas implícitas

Uma fase não deve ser decomposta em “pequenas ações” para contornar um gate.
Qualquer subtask recebe ID, owner, escopo, autorização, evidence IDs e estado;
provider, banco operacional, volume, pause e custo continuam sob os mesmos
gates da fase pai.
