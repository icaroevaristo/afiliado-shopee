# Phase Execution Playbook — R1–R9

**Status:** `LIVE_CANONICAL`
**Owner de governança:** `SOL_SUPERVISOR` (`READ_ONLY=true`)
**Único mutator:** `LUNA_MAX` (`SINGLE_MUTATOR=true`)
**Escrita de evidência:** `SOL_SUPERVISOR` somente em
`.runtime/autonomous-execution/manifests/<RUN_ID>/` (`SOL_MANIFEST_WRITE_ALLOWED=true`)

Este playbook é o lifecycle padrão para as fases R1–R9 do
`OPERATIONAL_READINESS_ROADMAP.md`. Ele organiza a execução, não concede
autorização para provider, migration, volume, SEND, remoção de pause ou
produção. A missão atual, `AGENTS.md`, o código e a autorização explícita da
task continuam superiores a este documento.

## Regras globais

- Um único `SOL_SUPERVISOR` congela scope, baseline, findings, gates e decisão.
- `LUNA_MAX` é o único agente que escreve na candidate branch; reviewers e
  especialistas são READ_ONLY.
- Cada run usa exatamente os doze arquivos de
  `EXECUTION_MANIFEST_PROTOCOL.md`; nenhum extra é permitido e nenhum
  manifesto fechado é sobrescrito.
- `SOL_SUPERVISOR_READ_ONLY=true` significa sem escrita na candidate, runtime,
  banco, Redis ou documentação versionada. A única exceção delimitada é a
  criação/atualização dos doze artifacts no path de execução local/ignorado;
  isso é escrita de evidência, não mutation da candidate.
- Antes de qualquer mutation, registrar scope/autorização e criar
  `RUN_MANIFEST.json` e `BASELINE.json`.
- Antes da revisão final, SOL atesta e o run-artifact store registra
  `CANDIDATE_HEAD`, `CANDIDATE_TREE` e `CANDIDATE_FROZEN=true`. Toda revisão
  registra `reviewedHead` e `reviewedTree`.
- Mutation depois do freeze invalida o candidato e as evidências afetadas;
  exige novo freeze e nova revisão. `CLOSED_COMPONENT_REOPEN_REQUIRES_CAUSAL_FINDING=true`.
- `AUTO_CONTINUE=true` permite a próxima ação já autorizada, dentro do scope,
  com gate/recovery conhecido e sem efeito proibido, inclusive mutation normal
  de código reversível por Git. Não concede autorização nova.
- **NÃO PARE ENTRE FASES/ETAPAS APENAS PARA RELATAR PROGRESSO.** Registre o
  checkpoint e continue quando a próxima etapa estiver autorizada e segura. Se
  a autorização acabou, encerre como `READY_FOR_NEXT_PHASE`.
- `HUMAN_REQUIRED`, `BLOCKED` e `UNKNOWN` preservam lacunas; não são convertidos
  em PASS por conveniência.

## Estados e transições

```text
E0 FREEZE_SCOPE
  → E1 PREFLIGHT
  → E2 SAFE_TEST_WINDOW
  → E3 PRIMARY_MUTATION
  → E4 CAUSAL_VALIDATION
  → E5 PROPORTIONAL_REGRESSION
  → E6 REVIEWER_A
  → E7 REVIEWER_B
  → E8 FIX_LOOP ───────────────┐
  → E9 FINAL_ADVERSARIAL       │
  → E10 SOL_RECONCILIATION ◄───┘ quando houver finding
```

Cada transição registra `EVIDENCE_ID`, owner, estado do gate e recovery. Um
finding P0/P1 interrompe a subtask afetada; tarefas independentes seguras podem
continuar sem esconder o blocker.

## E0 — FREEZE_SCOPE

### INPUT

Task atual, instruções superiores, `AGENTS.md`, roadmap, findings herdados,
autorização humana e ambiente informado.

### OWNER

`SOL_SUPERVISOR`.

### ALLOWED_ACTIONS

Interpretar objetivo; delimitar fase R1–R9; registrar `scope`,
`authorizedActions`, `prohibitedActions` e `humanRequiredBoundaries`; atribuir
`FINDING_ID`/`GATE_ID`; declarar `SOL_SUPERVISOR`, `LUNA_MAX` e reviewers;
iniciar os manifestos sem segredo.

### PROHIBITED_ACTIONS

Ampliar escopo; inventar autorização; editar candidate; iniciar provider,
worker, scheduler, migration, volume ou operação; remover pause; apagar finding.

### GATES

Objetivo concreto; fase identificada; autorizações e proibições separadas;
limites e stop conditions compreensíveis; single mutator designado.

### EVIDENCE

`RUN_MANIFEST.json`, `BASELINE.json`, `FINDINGS.json` inicial e checkpoint com
scope, owner, autorização e `EVIDENCE_ID`.

### RECOVERY

Escopo ambíguo ou autorização insuficiente → `HUMAN_REQUIRED`; não executar a
ação ambígua. Tarefas independentes permanecem visíveis no ledger.

### EXIT_CRITERIA

Scope congelado, papéis definidos, run criado e E1 explicitamente autorizado.

## E1 — PREFLIGHT

### INPUT

Scope congelado e manifestos de E0.

### OWNER

`SOL_SUPERVISOR`, com especialistas READ_ONLY para suas áreas.

### ALLOWED_ACTIONS

Validar repository, remote, branch, base/HEAD, worktree, skills, OS, classe do
ambiente, identidade Compose/DB/volume quando aplicável, findings e gates
herdados; executar somente comandos de leitura e testes sem efeitos.

### PROHIBITED_ACTIONS

Reset/clean/stash destrutivo; copiar secrets; alterar DB/Redis/volume/env;
iniciar runtime operacional; marcar PASS sem evidência atual.

### GATES

Baseline e diretório corretos; ambiente classificado; skills exigidas lidas;
identidade operacional provada ou não aplicável; worktree/deltas preservados.

### EVIDENCE

`BASELINE.json`, `ENVIRONMENT.json`, `EVIDENCE_INDEX.json` com comando, SHA,
exit code, timestamp, redactions e estado do gate.

### RECOVERY

Baseline/identidade divergente → `HUMAN_REQUIRED`/`DO_NOT_START`. Delta fora do
scope → parar a mutation e registrar blocker, sem descartar WIP.

### EXIT_CRITERIA

Preflight completo e `RUN_MANIFEST.status=PREFLIGHTED`; E2 pode iniciar sem
ação operacional implícita.

## E2 — SAFE_TEST_WINDOW

### INPUT

Preflight aprovado e classificação `TEST`, `LOCAL_ISOLATED` ou
`LOCAL_OPERATIONAL` explicitamente autorizada.

### OWNER

`SOL_SUPERVISOR` coordena; QA/especialistas executam somente testes aprovados.

### ALLOWED_ACTIONS

Usar mocks, fixtures sanitizadas e DB/Redis descartáveis quando isolados;
executar probes que não alcancem provider; validar que o contexto seguro existe.

### PROHIBITED_ACTIONS

Presumir dados sintéticos em `LOCAL_OPERATIONAL`; criar/reconfigurar grupo,
WhatsApp, sessão Evolution, provider, secret, banco ou volume operacional para
desbloquear o teste; executar Shopee/OpenAI/Evolution/SEND sem autorização
nomeada.

### GATES

Contexto seguro identificado; efeitos externos bloqueados; fixtures não herdam
`.env` operacional; limites de tempo/escopo definidos.

### EVIDENCE

Comandos e resultados sanitizados; profile/contexto; contadores de provider;
`EVIDENCE_ID` de cada probe e `UNKNOWN` quando não medido.

### RECOVERY

`SAFE_TEST_CONTEXT_MISSING` → tentar `LOCAL_ISOLATED`/harness aprovado;
se inexistente, `BLOCKED`. Não criar estado para contornar o bloqueio.

### EXIT_CRITERIA

Janela segura aprovada e E3 autorizado, ou blocker persistido com as subtasks
seguras concluídas.

## E3 — PRIMARY_MUTATION

### INPUT

Preflight e janela segura aprovados; mutation explicitamente dentro do scope.

### OWNER

`LUNA_MAX` exclusivamente.

### ALLOWED_ACTIONS

Implementar a mudança autorizada; atualizar somente a candidate branch;
adicionar causal tests; registrar arquivos e componentes no
`CHANGE_MANIFEST.json`; usar `AUTO_CONTINUE` para a sequência já autorizada.

### PROHIBITED_ACTIONS

Mutation por Sol/reviewer/especialista; escopo creep; operação destrutiva;
provider/DB/Redis/volume/config operacional não autorizado; segundo mutator.

### GATES

Diff mínimo; invariantes preservados; mudança reversível quando for código;
nenhum secret; nenhum componente fechado reaberto sem finding causal.

### EVIDENCE

Diff/status seletivo, `CHANGE_MANIFEST.json`, finding owner, teste causal
planejado e checkpoint de mutation.

### RECOVERY

Falha técnica corrigível → reproduzir, corrigir no mesmo scope e registrar novo
checkpoint. Risco fora da autorização → parar antes do efeito e marcar
`HUMAN_REQUIRED`/`SAFETY_STOP`.

### EXIT_CRITERIA

Mutation concluída ou blocker explícito; candidate pronto para E4; nenhum
reviewer avalia uma árvore ainda em mutação.

## E4 — CAUSAL_VALIDATION

### INPUT

Diff de E3, finding(s), contrato esperado e hipótese causal.

### OWNER

`LUNA_MAX` executa; `SOL_SUPERVISOR` verifica a evidência.

### ALLOWED_ACTIONS

Executar teste que falhava antes ou prova causal equivalente; usar mocks,
fixtures e ambientes isolados; revisar call graph mínimo.

### PROHIBITED_ACTIONS

Substituir causal test por build verde ou inspeção superficial; mascarar erro;
alcançar provider/DB/Redis operacional sem autorização; reviewer editar o teste
ou a correção.

### GATES

Teste reproduz diretamente a causa e passa depois; invariantes e semântica de
falha continuam explícitos.

### EVIDENCE

Comando, exit code, teste, resultado e SHA/tree; atualização de finding com
`CAUSAL_TEST_PASS` ou estado não aprovado.

### RECOVERY

Vermelho → investigar/corrigir dentro do scope. Ferramenta ausente →
`BLOCKED/NOT_AVAILABLE`, nunca PASS; nenhuma repetição cega.

### EXIT_CRITERIA

Cada finding relevante tem teste causal PASS ou permanece aberto/bloqueado; E5
está definido.

## E5 — PROPORTIONAL_REGRESSION

### INPUT

Causal tests, blast radius, change manifest e contratos afetados.

### OWNER

`LUNA_MAX`, com QA/especialistas READ_ONLY.

### ALLOWED_ACTIONS

Executar regressão proporcional: unit, integration, DB, scheduler, queue, API,
typecheck, lint, build, browser ou security quando o blast radius exigir;
registrar skips como `NOT_RUN`.

### PROHIBITED_ACTIONS

Executar suite cara sem relação apenas para produzir narrativa; chamar provider
real; alterar produção/DB operacional; ocultar skip ou falha.

### GATES

Resultados realmente executados; escopo testado cobre os consumidores afetados;
P0/P1 não mascarados; efeitos proibidos continuam zero/UNKNOWN conforme medição.

### EVIDENCE

Comandos, exit codes, contagens, skips, SHA/tree e atualização de
`GATES.json`/`EXTERNAL_EFFECTS.json`.

### RECOVERY

Falha corrigível → retornar a E3/E4 sem trocar de mutator. Falha de segurança,
efeito incerto ou lacuna crítica → congelar efeitos e abrir finding.

### EXIT_CRITERIA

Regressão proporcional concluída, ou cada lacuna marcada `BLOCKED`/`NOT_RUN`
com motivo; candidato pronto para freeze.

## E6 — REVIEWER_A

### INPUT

Diff final provisório, ledger, manifestos, evidências e candidato a congelar.

### OWNER

`REVIEWER_A`, READ_ONLY.

### ALLOWED_ACTIONS

O SOL_SUPERVISOR atesta o snapshot e registra os campos no run-artifact store
permitido; Reviewer A audita segurança, escopo, contratos e
testes somente nesse snapshot.

### PROHIBITED_ACTIONS

Editar candidate, corrigir finding, gerar novo diff, assumir aprovação de SHA
anterior ou receber conclusão otimista do mutator.

### GATES

Head/tree do review coincidem exatamente com o candidate; P0/P1 classificados;
evidência suficiente e sem secret/efeito proibido.

### EVIDENCE

Review com `reviewedHead`, `reviewedTree`, findings, decisão e `EVIDENCE_ID`;
registro correspondente no `RUN_MANIFEST`/`FINAL_MANIFEST`.

### RECOVERY

Mismatch → `INVALID`, `CANDIDATE_FROZEN=false`, novo candidato obrigatório.
Finding → E8; não corrigir durante o review.

### EXIT_CRITERIA

Reviewer A retornou decisão itemizada sobre o snapshot exato; E7 recebe o mesmo
snapshot ou um novo freeze formal.

## E7 — REVIEWER_B

### INPUT

Candidate congelado, review A, findings, manifestos e evidências sem resumo
otimista.

### OWNER

`REVIEWER_B`, READ_ONLY e independente de A.

### ALLOWED_ACTIONS

Revisar foco técnico complementar; confirmar invariantes, scope, efeitos,
secrets e validade do head/tree; registrar decisão independente.

### PROHIBITED_ACTIONS

Editar código/docs; aceitar tree diferente; apagar finding; transformar
`UNVERIFIED` em PASS; executar provider ou mutation.

### GATES

`reviewedHead`/`reviewedTree` coincidem; revisão não é autoaprovação; P0/P1 e
gates bloqueados estão visíveis.

### EVIDENCE

Review B itemizado com head/tree, perguntas, resultado, redactions e
`EVIDENCE_ID`.

### RECOVERY

Mismatch ou finding novo → invalidar o snapshot e retornar E8; sem corrigir o
próprio finding.

### EXIT_CRITERIA

Review B concluído sem alterar a candidate; E9 pode receber somente o conjunto
congelado de evidências.

## E8 — FIX_LOOP

### INPUT

Finding de Reviewer A/B ou adversarial, ligado a head/tree e ao finding ledger.

### OWNER

`SOL_SUPERVISOR` registra/coordena; `LUNA_MAX` é o único mutator.

### ALLOWED_ACTIONS

Registrar finding; delimitar correção; Luna alterar o scope autorizado; executar
causal test e regressão; recalcular evidências invalidadas; criar novo candidate
freeze e reenviar somente reviewers afetados.

### PROHIBITED_ACTIONS

Reviewer corrigir silenciosamente; apagar/rebaixar finding sem prova; manter
aprovação antiga; ampliar escopo por oportunidade; retry de efeito externo.

### GATES

Finding permanece visível; `mutationsAfterFreeze` e
`invalidatedEvidenceIds` completos; novo SHA/tree revisado; componente fechado
reaberto somente com finding causal.

### EVIDENCE

Delta do ledger, change manifest atualizado, causal/regressão, novo candidate e
novos reviews com head/tree.

### RECOVERY

Se não houver correção segura dentro do scope, `FIX_FIRST`/`BLOCKED`/`HUMAN_REQUIRED`;
preservar evidência e não liberar ship gate.

### EXIT_CRITERIA

Todos os findings do ciclo foram corrigidos e revisados, ou permanecem
explicitamente bloqueadores; só então prosseguir para E9/E10.

## E9 — FINAL_ADVERSARIAL

### INPUT

Novo candidato congelado, diff, spec/invariantes, finding ledger, doze
manifestos e evidence index.

### OWNER

`FINAL_ADVERSARIAL`, instância independente READ_ONLY.

### ALLOWED_ACTIONS

Tentar provar que a candidate não deve passar; procurar mismatch de SHA/tree,
scope creep, segundo mutator, boundary perigoso, finding desaparecido, ambiente
inseguro ou manifestos divergentes; retornar uma decisão normal `SHIP` ou
`FIX_FIRST`, ou uma decisão de recovery `BLOCKED` ou `HUMAN_REQUIRED` quando a
revisão não puder ser concluída com segurança. Esses quatro estados são
mutuamente exclusivos e devem ser registrados como `decision`, com
`decisionClass=normal` para os dois primeiros e `decisionClass=recovery` para os
dois últimos.

### PROHIBITED_ACTIONS

Receber conclusão otimista; editar; corrigir finding; autorizar PR/merge,
provider, SEND, scheduler, unpause, migration ou produção.

### GATES

Instância independente; `reviewedHead`/`reviewedTree` exatos; contraexemplos
tentados; P0/P1 não permanecem sem caminho de correção quando a decisão é
`SHIP`; falta de evidência ou mismatch exige `BLOCKED`/`HUMAN_REQUIRED`, nunca
`SHIP`.

### EVIDENCE

Relatório adversarial, decisão `SHIP`/`FIX_FIRST` ou recovery
`BLOCKED`/`HUMAN_REQUIRED`, `decisionClass`, head/tree, findings,
redactions e `EVIDENCE_ID`.

### RECOVERY

`FIX_FIRST` → E8; mismatch → novo freeze; falta de evidência → `BLOCKED` ou
`HUMAN_REQUIRED`, não SHIP.

### EXIT_CRITERIA

Adversarial conclui `SHIP` sobre o candidato exato e E10 é autorizado; ou
conclui `FIX_FIRST`, `BLOCKED` ou `HUMAN_REQUIRED` e o fluxo retorna a E8/E10
com o finding ou impedimento preservado. Nenhum dos quatro estados é convertido
em outro por conveniência.

## E10 — SOL_RECONCILIATION

### INPUT

Todos os manifestos, Git, candidate head/tree, findings, gates, Reviewer A/B,
adversarial, efeitos, custos, recovery, cleanup e documentação.

### OWNER

`SOL_SUPERVISOR`, READ_ONLY.

### ALLOWED_ACTIONS

Reconciliar consistência; conferir que cada aprovação aponta para o candidato;
validar `FINAL_MANIFEST.json`, `GIT_MANIFEST.json`, `EXTERNAL_EFFECTS.json`,
`MONTHLY_COST_LEDGER.json` e `HANDOFF_MANIFEST.md`; decidir `SHIP`, `FIX_FIRST`,
`BLOCKED` ou `HUMAN_REQUIRED`.

### PROHIBITED_ACTIONS

Editar candidate; pular revisão; inventar zero/custo/effect; autorizar sozinho
PR, merge, SEND, scheduler, unpause, migration, provider ou produção.

### GATES

Git/HEAD/tree coerentes; findings reconciliados; gates com evidência; efeitos e
custos observados ou `UNKNOWN`; documentação current; P0/P1 zero para SHIP.

### EVIDENCE

`solReconciliationHead`, `solReconciliationVerdict`, `FINAL_MANIFEST.json`,
evidence index final e handoff integral.

### RECOVERY

Qualquer divergência → `FIX_FIRST`, `BLOCKED` ou `HUMAN_REQUIRED`; preservar o
manifesto e não liberar a próxima decisão.

### EXIT_CRITERIA

Candidato reconciliado e handoff fechado; `READY_FOR_NEXT_PHASE` (em
`decision`/`nextRecommendedAction`, com `readyForNextPhase=true`) ou
`READY_FOR_GITHUB_REVIEW` somente com evidência e autorização compatíveis.
