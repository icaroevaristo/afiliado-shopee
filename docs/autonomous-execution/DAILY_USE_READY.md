# Daily Use Ready — Predicado de Ativação

**Status atual:** `NOT_READY`
**Valor atual:** `DAILY_USE_READY=false`
**Autoridade de ativação:** proprietário, com decisão humana explícita

## Regra principal

`MVP_PROJECT_DONE=true` e `PROJECT_DONE_CRITERIA=14/14_PASS` não satisfazem
este predicado. Eles preservam a conclusão histórica do MVP; não ligam a
automação, não removem `paused` e não autorizam provider.

## Predicado completo

`DAILY_USE_READY=true` somente quando todos os itens abaixo estiverem `PASS`
no mesmo contexto/manifesto ou quando a validade temporal estiver explicitada:

```text
CANONICAL_RUNTIME_IDENTITY
CANONICAL_DATABASE_AND_VOLUME
POST_MERGE_START_STOP
AUTHENTICATED_CONTROL_PLANE
API_PROXY_CALL_SITES_COVERED
STATUS_AND_BLOCKERS_TRUTHFUL
ONE_INSTANCE_MANY_GROUPS_CERTIFIED
N_INSTANCES_ONE_GROUP_ROTATION_CERTIFIED
ROTATION_RESTART_DRIFT_ZERO
DUPLICATE_SEND_ZERO
SILENT_REROUTE_ZERO
AMBIGUOUS_RETRY_ZERO
QUOTA_AND_EXTERNAL_BUDGETS_PROVEN
EVOLUTION_CONFIG_AND_SAFE_MODE_PROVEN
BROWSER_AND_OFFLINE_VALIDATION
RECOVERY_AND_RESTART_VALIDATION
SECURITY_SECRET_SCAN_PASS
DOCUMENTATION_CURRENT
CONTROLLED_SEND_CERTIFICATION
INDEPENDENT_ADVERSARIAL_REVIEW
P0_ZERO
P1_ZERO
OWNER_ACTIVATION_DECISION
```

Os gates não aplicáveis devem ser explicitamente justificadas; não podem ser
convertidos em PASS por silêncio. Para um produto que ainda não implementa
rotação multi-sender, os itens de rotação ficam `NOT_RUN`/`OPEN`, e o predicado
permanece falso.

## Pré-condições e segurança

Antes da decisão do owner:

- `paused=true` permanece a condição segura;
- processo, API, Dashboard e worker podem estar desligados ou em modo
  SEND-ready pausado, conforme o manifesto;
- não há `ambiguity` ou `investigationRequired` pendente;
- DB/volume e filas são canônicos e identificados;
- secrets não aparecem em Git, logs, args, browser, storage ou artifacts;
- custos pagos e budgets têm owner e limite explícitos.

O agente pode preparar evidência e apresentar blockers. Só o proprietário
decide retirar a pausa. A ação de ativação deve ter seu próprio registro de
autorização; este documento não é autorização.

## Falha ou regressão

Qualquer P0/P1, efeito externo não autorizado, estado ambíguo, volume/DB
incerto, assignment stale, reroute, retry após possível efeito ou teste crítico
não executado impede `DAILY_USE_READY`. A resposta é preservar a pausa,
conter produção e criar/atualizar um finding, não forçar o gate.
