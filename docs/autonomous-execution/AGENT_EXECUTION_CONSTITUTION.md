# Constituição de Execução dos Agentes

**Status:** `LIVE_CANONICAL` para futuras tasks pós-MVP

Esta constituição organiza agentes; não substitui instruções superiores de
segurança, o `AGENTS.md`, o usuário ou os contratos do código.

## 1. Princípio central

`SINGLE_INTEGRATOR=true`.

Um único Orchestrator mantém o estado da task, a branch candidate, o finding
ledger e a decisão final. Especialistas podem analisar em paralelo, mas só o
integrador incorpora alterações na branch. Nunca existem dois mutators sobre o
mesmo componente stateful.

```text
ORCHESTRATOR / SINGLE INTEGRATOR
├── PRIMARY MUTATOR
├── BACKEND / DATA SPECIALIST
├── SCHEDULER / RUNTIME SPECIALIST
├── FRONTEND / UX SPECIALIST
├── QA / ADVERSARIAL TESTER
├── SECURITY / SECRETS REVIEWER
├── SOL INDEPENDENT REVIEWER
└── FINAL ADVERSARIAL / SHIP GATE
```

Reviewers são `READ_ONLY=true`. Não podem editar silenciosamente o código ou a
documentação que estão auditando.

## 2. Ordem de uma task

```text
baseline → scope → precheck → finding ledger → change → causal test
→ proportional regression → independent review → ship gate → handoff
```

Cada transição precisa de `EVIDENCE_ID`. Se uma ferramenta não executou, o
estado é `NOT_RUN`, `BLOCKED` ou `HUMAN_REQUIRED`; nunca PASS inferido.

## 3. AUTO_CONTINUE

`AUTO_CONTINUE=true` somente para ações documentais, read-only, reversíveis e
explicitamente autorizadas pela task. O Orchestrator pode continuar sozinho
quando a próxima ação já estiver definida, não tocar produção/estado
operacional, não gastar dinheiro e não depender de decisão de produto.

`BLOCK_AFFECTED_SUBTASK_ONLY=true`: uma subtask bloqueada não congela tarefas
independentes seguras, mas o bloqueio deve permanecer visível no ledger.

## 4. Gatilhos de HUMAN_REQUIRED

Parar antes do efeito quando houver:

- SEND Evolution/WhatsApp, geração OpenAI ou Shopee HTTP sem autorização e
  budget explícitos;
- migration, seed, alteração de quota/pausa, volume ou banco operacional;
- secret ausente, ambíguo ou a ser rotacionado;
- ambiguity, possível efeito externo ou ownership não comprovada;
- activation do Scheduler ou remoção de pause;
- decisão de produto conflitante, custo pago novo ou operação destrutiva;
- branch, baseline, database identity, assignment ou schedule revision
  irresolúvel.

`HUMAN_REQUIRED` não é atalho para encerrar cedo. O agente deve registrar causa,
evidência, tentativas seguras e subtarefas independentes concluídas.

## 5. Política de mutação

Toda mudança futura exige branch dedicada a partir de baseline verificada,
diff pequeno, sem reset/clean/stash/force push destrutivo, causal test,
regressão proporcional e revisão independente. Para banco/runtime:

- `MULTIPLE_MUTATORS_ON_SAME_STATEFUL_COMPONENT=false`;
- DB operacional somente com autorização nomeada;
- teste prefere DB/Redis descartável;
- nenhum secret operacional é copiado para teste;
- stop normal não remove volume;
- um provider call incerto nunca é repetido automaticamente.

## 6. Contratos de execução

### 6.1 Banco/Compose

O agente deve provar `OPERATIONAL_COMPOSE_PROJECT=afiliado-shopee` e
`OPERATIONAL_POSTGRES_VOLUME=afiliado-shopee_postgres_data` antes de iniciar o
perfil operacional. Volume ausente/ambíguo/divergente significa
`DO_NOT_START_OPERATIONAL_RUNTIME`; não criar banco vazio silenciosamente.

### 6.2 Scheduler e routing

O Scheduler comercial é único. Um target aceito carrega identidade do grupo,
instância, slot e revision. Reassignment não pode afetar job já aceito. Para a
futura rotação multi-sender, a instância é escolhida pelo slot planejado antes
do enqueue e não pelo número de sucessos; indisponibilidade bloqueia o slot,
sem fallback silencioso.

### 6.3 Provider

Gates baratos vêm antes do provider: target, assignment sticky, provenance,
copy, quota, budget, cooldown, safe mode e ambiguity. Toda tentativa externa é
contabilizada antes do call quando a política de custo exigir; cache hit não
consome geração. O boundary de SEND não pode ser duplicado.

## 7. Recovery matrix

| Evento | Ação automática segura | Resultado |
| --- | --- | --- |
| teste falha | identificar causa, corrigir, causal test, regressão | continuar se fechado |
| ferramenta de teste indisponível | provar indisponibilidade e alternativa equivalente | `BLOCKED/NOT_AVAILABLE`, não PASS |
| lock Prisma ocupado | identificar owner sem matar | bloquear gate afetado |
| identidade DB não provada | não iniciar | `HUMAN_REQUIRED` |
| volume canônico ausente | não criar volume | `HUMAN_REQUIRED` |
| múltiplos volumes candidatos | não escolher | `HUMAN_REQUIRED` |
| instância do slot indisponível | bloquear slot previsto | preservar rotação |
| assignment/schedule revision stale | rejeitar sem retry | sem SEND |
| efeito externo pode ter iniciado | preservar lifecycle | investigação manual, retry `0` |
| output OpenAI inválido | terminalizar conforme contract | não regenerar o mesmo contract |
| documento conflitante | conferir código/Git/evidência | `HUMAN_REQUIRED` se irresolúvel |

## 8. Finding → fechamento

Um finding só passa de `OPEN` para `CLOSED` com:

`FIX` + `CAUSAL_TEST_PASS` + `PROPORTIONAL_REGRESSION_PASS` + revisão quando o
blast radius exigir. O Orchestrator nunca remove finding apenas porque uma nova
task começou.

## 9. Revisão independente

Sol recebe baseline, diff, ledger, evidências e perguntas adversariais sem um
resumo otimista. O prompt deve tentar refutar a propriedade de segurança, por
exemplo: “demonstre um interleaving que cause drift de rotação após restart”.
Sol não pode corrigir o próprio finding. P0/P1 não podem permanecer no ship gate.
