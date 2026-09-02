# Constituição de Execução dos Agentes

**Status:** `LIVE_CANONICAL` para futuras tasks pós-MVP

Esta constituição organiza agentes; não substitui instruções superiores de
segurança, o `AGENTS.md`, o usuário ou os contratos do código.

## 1. Princípio central

`SOL_SUPERVISOR=true`.
`SOL_SUPERVISOR_READ_ONLY=true`.
`SINGLE_INTEGRATOR=true`.
`SINGLE_MUTATOR=LUNA_MAX`.

O SOL_SUPERVISOR é o Orchestrator/integrador de governança: mantém o estado da
task, a branch candidate, o finding ledger, os gates e a decisão final, mas não
edita arquivos. A LUNA_MAX é o único agente que pode mutar a candidate branch.
Especialistas e reviewers podem analisar em paralelo, mas são READ_ONLY.
Nunca existem dois mutators sobre o mesmo componente stateful.

```text
SOL SUPERVISOR / SINGLE INTEGRATOR / READ_ONLY
├── LUNA MAX / SINGLE MUTATOR
├── BACKEND / DATA SPECIALIST
├── SCHEDULER / RUNTIME SPECIALIST
├── FRONTEND / UX SPECIALIST
├── QA / ADVERSARIAL TESTER
├── SECURITY / SECRETS REVIEWER
├── SOL INDEPENDENT REVIEWER
└── FINAL ADVERSARIAL / SHIP GATE
```

Reviewers são `READ_ONLY=true`. Não podem editar silenciosamente o código ou a
documentação que estão auditando. Supervisão, review e mutation são papéis
distintos; somente `LUNA_MAX` escreve na candidate.

## 2. Ordem de uma task

```text
baseline → scope → precheck → finding ledger → change → causal test
→ proportional regression → candidate freeze → independent review
→ ship gate → Sol reconciliation → handoff
```

Cada transição precisa de `EVIDENCE_ID`. Se uma ferramenta não executou, o
estado é `NOT_RUN`, `BLOCKED` ou `HUMAN_REQUIRED`; nunca PASS inferido.

## 3. AUTO_CONTINUE

`AUTO_CONTINUE=true` quando a próxima ação:

- estiver explicitamente autorizada pela task;
- estiver dentro do scope/spec;
- for uma mutation normal e reversível por Git quando alterar código;
- possuir gate e recovery conhecidos;
- não ampliar o escopo;
- não envolver decisão de produto aberta;
- não depender de secret ausente ou ambíguo;
- não envolver operação destrutiva;
- não produzir efeito externo não autorizado;
- não alterar banco/volume operacional sem autorização específica;
- não executar SEND/provider/custo fora da autorização.

Mutation de código explicitamente autorizada não é, por si só, motivo para
`HUMAN_REQUIRED`. `AUTO_CONTINUE` não concede autorização nova e não atravessa
nenhum boundary perigoso. O SOL_SUPERVISOR pode continuar quando a próxima
ação já estiver definida, os gates forem conhecidos e a decisão não depender do
proprietário.

`BLOCK_AFFECTED_SUBTASK_ONLY=true`: uma subtask bloqueada não congela tarefas
independentes seguras, mas o bloqueio deve permanecer visível no ledger.

O Orchestrator não deve parar entre fases/etapas apenas para relatar progresso.
Quando a próxima etapa já estiver autorizada, dentro do scope e sem efeito
proibido, registra checkpoint/manifest e continua. Se a autorização abranger
somente uma fase, encerra como `READY_FOR_NEXT_PHASE` no handoff/decision, sem
ampliar o escopo.

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

## 5.1 Candidate freeze e validade da revisão

Antes do ciclo de revisão final, o SOL_SUPERVISOR registra:

```text
CANDIDATE_HEAD=<SHA>
CANDIDATE_TREE=<tree digest verificável>
CANDIDATE_FROZEN=true
```

Toda evidência, review e decisão deve carregar `reviewedHead` e `reviewedTree`.
Se a LUNA_MAX alterar qualquer arquivo depois do freeze:

```text
CANDIDATE_FROZEN=false
NEW_CANDIDATE_REQUIRED=true
REVIEW_VERDICT_HEAD_MISMATCH=INVALID
FINAL_ADVERSARIAL_HEAD_MISMATCH=INVALID
SHIP_GATE_HEAD_MISMATCH=INVALID
```

O SOL_SUPERVISOR calcula os gates/evidências invalidados e reinicia a revisão
afetada sobre o novo candidato. Componente já certificado só pode ser reaberto
por finding causal:

```text
CLOSED_COMPONENT_REOPEN_REQUIRES_CAUSAL_FINDING=true
```

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
blast radius exigir. O SOL_SUPERVISOR nunca remove finding apenas porque uma
nova task começou.

## 9. Revisão independente

Sol recebe baseline, diff, ledger, manifestos, `CANDIDATE_HEAD`/`CANDIDATE_TREE`
e perguntas adversariais sem um resumo otimista. O adversarial deve tentar
refutar a propriedade de segurança, por exemplo: “demonstre um interleaving que
cause drift de rotação após restart”. Sol não pode corrigir finding nem editar o
candidato. P0/P1 não podem permanecer no ship gate. Aprovação de SHA/tree
anterior é inválida para qualquer candidato posterior.
