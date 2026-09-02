# Red-Team Checklist — Pacote Autônomo

**Status:** `LIVE_CANONICAL`
**Uso:** revisão adversarial obrigatória antes de fechar uma fase de alto
impacto. Este arquivo não é um resultado de execução.

O reviewer deve tentar construir um contraexemplo reproduzível para cada grupo
abaixo. Para cada resposta, registrar `PASS`, `FAIL`, `BLOCKED` ou `UNKNOWN`, o
`EVIDENCE_ID` e o SHA auditado. Se a pergunta não puder ser respondida, não
converter a lacuna em PASS.

## Perguntas

1. O agente ainda confunde `PROJECT_DONE` com `DAILY_USE_READY` ou remove a
   pausa sem decisão do proprietário?
2. Duas worktrees podem escolher Compose project, volume ou banco diferentes no
   perfil operacional? Um banco vazio poderia ser criado silenciosamente?
3. Uma migration poderia alcançar DB remoto, histórico divergente ou mais de
   uma pending migration?
4. Dois schedulers/processos podem planejar o mesmo slot, job ou dispatch?
5. Um assignment ou revision pode mudar depois do job aceito e alcançar grupo
   ou instância errados?
6. A rotação N-instâncias→um grupo usa sucessos, disponibilidade momentânea ou
   fallback para decidir o próximo slot? Qual é o drift após restart/replan?
7. Um job stale, duplicado ou órfão pode chegar ao orchestrator/provider?
8. Existe retry/requeue depois de timeout, reset, resposta sem ID ou qualquer
   resultado em que o provider pode ter iniciado?
9. O Dashboard pode mostrar “online” quando API, auth, worker, Evolution ou
   banco está apenas parcialmente disponível?
10. Algum endpoint, CLI, diagnóstico ou Dashboard cria um segundo send boundary
    ou contorna quota/assignment/attempt policy?
11. Falha Shopee/OpenAI/Evolution pode produzir loop de custo, geração repetida
    ou chamada antes dos gates baratos?
12. Um secret pode entrar em log, exception, HTML/JS, URL, storage, shortcut,
    runtime env versionado ou artifact?
13. Recovery pode reescrever lifecycle histórico, perder outbox, reenfileirar
    ambiguidade ou remover evidência?
14. `system:status` pode passar com lock stale, PID reutilizado, processo
    externo na porta ou árvore parcialmente iniciada?
15. Testes podem herdar `.env` operacional, depender de estado da máquina ou
    declarar PASS sem realmente executar o comando?
16. A documentação antiga contém comandos, status ou nomes de volume que um
    agente pode seguir fora de contexto?
17. Há custo pago/recorrente novo não registrado em `MONTHLY_COST_LEDGER`?
18. Um blocker é simplesmente marcado `HUMAN_REQUIRED` sem registrar causa,
    evidência e ações seguras independentes?

## Red-team da autonomia documental

19. O `SOL_SUPERVISOR` consegue alterar candidate code/docs apesar de ser
    `READ_ONLY`?
20. Um reviewer consegue corrigir silenciosamente o próprio finding?
21. Uma aprovação contra `HEAD`/tree antigo consegue liberar candidate novo?
22. Dois mutators conseguem alterar o mesmo componente stateful?
23. Componente fechado pode ser reaberto sem finding causal?
24. Falta de ambiente seguro pode provocar criação de estado operacional?
25. `AUTO_CONTINUE` pode atravessar SEND/provider/DB boundary sem autorização?
26. O Orchestrator pode parar só para relatar progresso e deixar etapa autorizada
    sem execução?
27. Handoff pode omitir diff, Git, gates, findings ou decisão final?
28. O adversarial recebe contexto otimista suficiente para enviesar a revisão?
29. SHIP adversarial consegue pular Sol reconciliation?
30. Review de SHA antigo permanece válido depois de mutation?
31. O playbook permite subtask implícita que contorne um gate?
32. Os doze manifestos podem divergir quanto a scope, HEAD ou efeitos?

## Resultado mínimo

O reviewer deve anexar as respostas ao `EVIDENCE_INDEX`, listar contraexemplos
e classificar P0/P1/P2. Finding P0/P1 exige reparo/review antes do ship gate;
não é permitido fechar a revisão apenas com “parece seguro”.
