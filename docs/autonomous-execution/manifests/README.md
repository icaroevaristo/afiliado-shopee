# Diretório de Manifestos

Cada execução futura usa uma pasta exclusiva:

```text
docs/autonomous-execution/manifests/<RUN_ID>/
```

O `<RUN_ID>` deve ser único, estável e não conter segredo. Use os doze arquivos
definidos em `../EXECUTION_MANIFEST_PROTOCOL.md` para novas execuções. Não
reutilize uma pasta de uma execução anterior nem sobrescreva evidência fechada.

O conjunto é:

```text
RUN_MANIFEST.json
BASELINE.json
ENVIRONMENT.json
FINDINGS.json
GATES.json
EVIDENCE_INDEX.json
EXTERNAL_EFFECTS.json
MONTHLY_COST_LEDGER.json
CHANGE_MANIFEST.json
GIT_MANIFEST.json
FINAL_MANIFEST.json
HANDOFF_MANIFEST.md
```

Regras rápidas:

- preencher `BASELINE.json` antes de qualquer mutation;
- congelar `CANDIDATE_HEAD`/`CANDIDATE_TREE` antes da revisão final;
- invalidar reviews/evidências quando houver mutation após o freeze;
- registrar todos os findings herdados relevantes;
- usar `UNKNOWN` quando uma contagem não foi observada;
- manter comandos e logs sanitizados;
- não armazenar `.env`, tokens, headers, cookies, payloads comerciais ou
  credenciais;
- anexar apenas artifacts necessários e ignorados quando contiverem estado
  local;
- fechar `CHANGE_MANIFEST.json`, `GIT_MANIFEST.json`, `FINAL_MANIFEST.json` e
  `HANDOFF_MANIFEST.md`, com revisão independente quando exigida.

Este diretório contém o contrato e não uma execução operacional. A ausência de
uma pasta `<RUN_ID>` não prova readiness.
