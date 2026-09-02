# Finding Ledger — Schema e Regras

**Status:** `LIVE_CANONICAL`
**Regra:** o ledger é a memória de trabalho auditável. Um finding não pode
desaparecer porque a task mudou, um agente foi reiniciado ou um teste ficou
verde.

## Registro obrigatório

Cada finding deve conter, no mínimo:

```yaml
findingId: GAP-XX ou FXX-PX-YY
title: texto curto
severity: P0 | P1 | P2
status: OPEN | IN_PROGRESS | FIXED | PARTIALLY_FIXED | CLOSED | BLOCKED | HUMAN_REQUIRED | REJECTED
scope: código | schema | runtime | dashboard | docs | operação
source: caminho, função, commit ou incidente
trigger: precondição reproduzível
actualBehavior: comportamento observado
expectedBehavior: contrato esperado
impact: external effect, safety, cost, data ou UX
evidenceIds: [EVIDENCE_ID]
reproduction: comando, teste ou argumento arquitetural
owner: papel responsável
authorizedAction: escopo autorizado
minimalFix: direção, sem implementação automática
causalTest: teste que fecha a causa
regressionTests: testes proporcionais
review: Sol/reviewer e decisão
openedAt: ISO-8601
updatedAt: ISO-8601
closedAt: ISO-8601 ou null
```

`actualBehavior` e `expectedBehavior` devem ser factuais. Segredos, tokens,
JIDs completos, payloads e cópias comerciais não entram no ledger; use
fingerprint ou estado sanitizado.

## Estados

- `OPEN`: hipótese ou bug com evidência suficiente para investigação.
- `IN_PROGRESS`: ação autorizada em andamento.
- `FIXED`: correção causal aplicada, ainda aguardando fechamento formal.
- `PARTIALLY_FIXED`: parte protegida; residual explicitamente listado.
- `CLOSED`: `FIX` + teste causal + regressão proporcional + review exigidos.
- `BLOCKED`: impedido por ferramenta ou pré-condição, sem fingir PASS.
- `HUMAN_REQUIRED`: autoridade, segredo, custo, banco, provider ou decisão de
  produto necessária.
- `REJECTED`: falso positivo demonstrado por evidência direta; registrar a
  refutação, não apenas a palavra “rejeitado”.

## Fechamento

Para mover um finding para `CLOSED`, o Orchestrator deve apontar para:

1. mudança mínima identificável;
2. reprodução que falhava antes ou uma prova causal equivalente;
3. teste que passa depois;
4. regressão proporcional;
5. revisão independente quando o blast radius for P0/P1;
6. ausência de efeitos proibidos;
7. SHA final revisado.

Se a correção não foi implementada, o finding permanece `OPEN` ou
`PARTIALLY_FIXED`. A indisponibilidade de ferramenta não converte o finding em
`CLOSED`.

## Ledger inicial desta arquitetura

| ID | Severity | Status | Resumo | Evidência | Próximo dono |
| --- | --- | --- | --- | --- | --- |
| GAP-01 | P1 | PARTIALLY_FIXED | identidade/volume canônicos corrigidos no código; smoke pós-merge não provado | E30-CODE-001, E30-OP-001 | R1 |
| GAP-02 | P1 | OPEN | allowlist/proxy não cobre claramente detalhe e copy-preview de Ofertas usados pela UI | E30-CODE-003 | R2 |
| GAP-03 | P1 | PARTIALLY_FIXED | auth/token server-side existem; quickstart autenticado não evidenciado | E30-CODE-005 | R2 |
| GAP-04 | P1 | PARTIALLY_FIXED | blockers são derivados; causa concreta do ambiente não foi correlacionada | E30-CODE-004, E30-OP-001 | R3 |
| GAP-05 | P2 | REJECTED | `UNKNOWN` sem heartbeat é comportamento honesto, não falso online | E30-CODE-004 | R3 apenas se heartbeat for desejado |
| GAP-06 | P1 | PARTIALLY_FIXED | modelo permite um número com vários grupos; certificação específica ausente | E30-CODE-002 | R4 |
| GAP-07 | P1 | OPEN | não há rotação N-instâncias→um grupo determinística por slot | E30-CODE-002 | R5 |
| GAP-08 | P1 | OPEN | UI não expõe estratégia/ordem N-sender | E30-CODE-002 | R6 |
| GAP-09 | P2 | OPEN | browser smoke/matriz visual não foi executado nesta missão | E30-OP-001 | R7 |
| GAP-10 | P1 | OPEN | checklist de certificação final ainda não foi executado/evidenciado | E30-OP-001 | R8 |
| GAP-11 | P1 | HUMAN_REQUIRED | retirar pausa/ativar operação é decisão do proprietário | E30-DOC-001 | R9 |

O ledger inicial não afirma que gaps foram corrigidos. Fases futuras devem
copiar os registros relevantes para o manifesto da execução e acrescentar
evidência nova.

## Findings da correção final da Fase 30

Estes findings foram abertos pela revisão externa da branch documental e só
podem ser fechados após validação causal, regressão proporcional e revisão em
um candidato congelado:

| ID | Severity | Status | Resumo | Evidência | Owner | Causal test |
| --- | --- | --- | --- | --- | --- | --- |
| F30-P1-01 | P1 | FIXED | `AUTO_CONTINUE` restritivo demais para mutation autorizada | E30-DOC-008 | LUNA_MAX | policy matrix: mutation autorizada continua; boundary perigoso para |
| F30-P1-02 | P1 | FIXED | protocolo não exige CHANGE/GIT/FINAL manifest | E30-DOC-008 | LUNA_MAX | schema/lista exige 12 arquivos |
| F30-P1-03 | P1 | FIXED | Orchestrator pode parar só para relatar progresso | E30-DOC-008 | LUNA_MAX | master prompt contém regra de continuidade |
| F30-P1-04 | P1 | FIXED | supervisor e mutator não estavam separados nominalmente | E30-DOC-008 | LUNA_MAX | roles e READ_ONLY/single-mutator são explícitos |
| F30-P1-05 | P1 | FIXED | aprovação não estava vinculada a candidate SHA/tree | E30-DOC-008 | LUNA_MAX | mutation pós-freeze invalida review/evidence |
| F30-P1-06 | P1 | FIXED | lifecycle E0–E10 não tinha playbook LIVE_CANONICAL | E30-DOC-008 | LUNA_MAX | playbook possui os oito campos em cada etapa |
| F30-P1-07 | P1 | FIXED | conjunto fechado e schema mínimo dos manifestos não eram enforceáveis | E30-REDTEAM-002; E30-DOC-009 | LUNA_MAX | exatamente doze nomes, campos mínimos por arquivo e ausência de extras |
| F30-P1-08 | P1 | FIXED | freeze e revisões não carregavam todos os pares SHA/tree nos templates | E30-REDTEAM-002; E30-DOC-009 | LUNA_MAX | GIT_MANIFEST e cada revisão têm tree obrigatório pareado ao head |
| F30-P1-09 | P1 | FIXED | escopo READ_ONLY do Sol conflitava com escrita de manifestos/freeze | E30-REDTEAM-002; E30-DOC-009 | LUNA_MAX | Sol só escreve artifacts no run store ignorado e não edita candidate |
| F30-P2-01 | P2 | FIXED | saída do E9 não distinguia decisão normal de recovery | E30-REDTEAM-002; E30-DOC-009 | LUNA_MAX | quatro estados e decisionClass explícitos |

`FIXED` indica que a alteração causal foi aplicada, mas ainda aguarda review e
ship gate. Após `E30-REDTEAM-002`, `E30-SOL-002` e `E30-SHIP-002`, cada item pode
passar a `CLOSED` somente se a evidência realmente existir; nenhum finding é
removido.
