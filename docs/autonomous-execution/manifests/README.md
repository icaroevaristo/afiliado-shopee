# Diretório de Manifestos

Cada execução futura usa uma pasta exclusiva:

```text
docs/autonomous-execution/manifests/<RUN_ID>/
```

O `<RUN_ID>` deve ser único, estável e não conter segredo. Use os nove
arquivos definidos em `../EXECUTION_MANIFEST_PROTOCOL.md`. Não reutilize uma
pasta de uma execução anterior nem sobrescreva evidência fechada.

Regras rápidas:

- preencher `BASELINE.json` antes de qualquer mutation;
- registrar todos os findings herdados relevantes;
- usar `UNKNOWN` quando uma contagem não foi observada;
- manter comandos e logs sanitizados;
- não armazenar `.env`, tokens, headers, cookies, payloads comerciais ou
  credenciais;
- anexar apenas artifacts necessários e ignorados quando contiverem estado
  local;
- fechar com `HANDOFF_MANIFEST.md` e revisão independente quando exigida.

Este diretório contém o contrato e não uma execução operacional. A ausência de
uma pasta `<RUN_ID>` não prova readiness.
