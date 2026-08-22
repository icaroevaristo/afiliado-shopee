# Afiliado Shopee — MVP oficial e roadmap do projeto

> **Fonte oficial de escopo e status macro do projeto.** Este documento define o MVP, o roadmap restante e o critério `PROJECT_DONE` para uso próprio/autônomo.
>
> Os documentos `docs/phase-*.md`, `docs/shopee-affiliate.md` e outros contratos técnicos continuam sendo a fonte detalhada de cada subsistema. Quando uma documentação antiga divergir deste documento sobre **escopo final do MVP** ou **status atual**, prevalece este documento. Não se pretende reescrever os contratos técnicos existentes.
>
> Estado auditado contra `main` em `e37b6816e85dfca7117bc3d56019d716aa978159` e evidências operacionais certificadas até a conclusão da Fase 12 em 2026-08-22.

## 1. Objetivo final

O Afiliado Shopee deve operar autonomamente, para uso próprio, durante uma janela configurada, executando de ponta a ponta:

`buscar produtos Shopee -> atualizar catálogo -> deduplicar -> filtrar -> pontuar -> ranquear -> selecionar produto adequado ao nicho/grupo -> validar link afiliado/provenance -> gerar ou reutilizar copy com IA -> validar copy -> montar mensagem com imagem -> selecionar número/instância WhatsApp -> publicar nos grupos corretos -> registrar lifecycle/resultados -> repetir conforme agenda configurada`.

O objetivo não é apenas conseguir enviar. O sistema final precisa escolher **o que**, **para quem**, **por qual número** e **quando** enviar, sem intervenção humana ordinária, preservando dedupe, quotas, cooldown, idempotência, exatamente uma tentativa nos boundaries críticos e recovery fail-closed.

O proprietário deve conseguir compreender e controlar a operação normal pelo painel, sem consultar diretamente PostgreSQL, Redis ou BullMQ.

## 2. Definição oficial do MVP

O MVP oficial é considerado funcional somente quando os blocos abaixo estiverem integrados e operáveis em conjunto:

1. **Ingestão oficial Shopee:** buscar ofertas pelo provider oficial; persistir/atualizar catálogo e snapshots; deduplicar por identidade estável; preservar revisão/fingerprint da oferta.
2. **Seleção comercial:** filtros; scoring/ranking determinísticos; nicho/categoria por grupo; fairness; dedupe/histórico por destino.
3. **Conteúdo seguro:** validar affiliate link/provenance; reutilizar ou gerar copy; validar Copy V10; montar draft com imagem/link/copy certificados.
4. **Orquestração:** suportar várias instâncias e grupos; decidir instância/grupo/candidate; respeitar janela, quotas, cooldown e stagger; criar apenas o one-shot necessário.
5. **SEND/lifecycle:** dispatch/outbox/Sender únicos e idempotentes; uma tentativa nos boundaries críticos; resultado terminal fail-closed; candidate/run/execution/outbox/reservation reconciliados.
6. **Painel:** configurar instâncias, grupos, campanhas, horários, intervalos, limites e stagger; catálogo navegável; envio manual pelo mesmo pipeline; status/blockers operacionais.
7. **Operação contínua:** scheduler recorrente confiável, restart/recovery seguro e múltiplos ciclos sucessivos sem duplicidade.

Ficam fora do MVP: SaaS multiusuário, billing, aplicativo mobile nativo e analytics avançado, salvo dependência técnica futura comprovada.

## 3. Arquitetura funcional resumida

```text
Shopee Official Provider
  -> ShopeeOfferSyncService
  -> ProductLead + OfferSnapshot
  -> Promotion Mining / filters / niche matching
  -> PromotionCandidate queue + deterministic rank
  -> CommercialAutomationCandidateFlowService
  -> provenance + copy cache/generation/validator
  -> CommercialMessageDraft
  -> policy/reservation
  -> CommercialPipeline
  -> WhatsAppDispatch + CommercialDispatchOutbox
  -> Sender / Evolution provider
  -> finalizer + delivery history + release reservation
```

Princípios obrigatórios:

- identidade de produto não depende de estado comercial mutável;
- snapshots/revisões/fingerprints são a base de provenance;
- ranking não é refeito oportunisticamente depois da fila;
- candidate melhor ranqueado não é pulado silenciosamente para esconder falha;
- dedupe/histórico são por destino/grupo;
- dispatch/outbox/Sender são o único caminho de publicação real;
- retry após possível efeito externo é fail-closed;
- painel e envio manual não criam segundo caminho de SEND.

## 4. Requisitos multi-número

### Estado atual

**NOT_STARTED como capacidade completa do MVP.** Existem fundações de instância/destino (`sourceInstanceName`, provider/worker WhatsApp), mas runtime/policy principal ainda gira em torno de uma única `EVOLUTION_INSTANCE_NAME`. Não há prova de operação simultânea real com N instâncias nem configuração independente pelo painel.

### Requisito oficial

O sistema deve suportar **N instâncias/números**, sem arquitetura fixa para dois. Cada instância precisa ter identidade, credenciais/connection state, ativo/inativo, pausa individual, janela inicial/final, intervalo, limite, grupos atribuídos, próximo/último envio e health visível no painel.

Exemplo apenas ilustrativo:

```text
Número 1: 08:00, 08:30, 09:00, 09:30
Número 2: 08:15, 08:45, 09:15, 09:45
```

Uma instância indisponível não pode provocar troca silenciosa para outra se isso alterar a rota sem configuração explícita.

## 5. Requisitos multi-grupo

### Estado atual

**Parcialmente implementado, não certificado como MVP real multi-grupo.** Há fairness/multi-group em `docs/phase-3-fairness-selection.md`, destinos/fingerprint/policy em `docs/phase-7-destinations-publication-policies.md`, campanhas/nichos e `categoryIds` em `commercial-niche-domain.ts`/`commercial-niche-matcher.ts`. Falta prova operacional simultânea, assignments completos e configuração pelo painel.

### Requisito oficial

Cada grupo deve ter destino/fingerprint, nicho/categoria, campanha, instância(s) responsáveis, ativo/inativo, pausa quando aplicável, limites/cadência e histórico/dedupe por grupo. Exemplos: Achadinhos gerais, Maternidade/Bebê, Casa e Decoração, Tecnologia, Beleza, Moda e outros.

**Não é válido** enviar automaticamente o mesmo produto a todos os grupos só porque tem score alto; o candidate precisa satisfazer nicho e regras do grupo.

## 6. Scheduler, cadência e stagger

### Estado atual

**Core existe; orquestração temporal final ainda não está DONE.** Já existem janela, quotas global/grupo/campanha, minimum interval/cooldown, scheduler/worker, tick com no máximo um target confirmado, recovery/reservas fail-closed e pause. Fase 10 normalizou o runtime e Fase 11 provou one-shot real; isso não equivale a agenda autônoma multi-instância/multi-grupo.

### Requisito oficial

A agenda deve considerar janela/intervalo da instância, grupos atribuídos, policy/cooldown/quota, stagger, disponibilidade e blockers. Quando uma instância atende vários grupos, os envios devem ser espaçados, por exemplo:

```text
08:00:00 -> Grupo A
08:02:00 -> Grupo B
08:05:00 -> Grupo C
```

Não criar rajadas simultâneas. O stagger deve ser persistido/configurável e sobreviver a restart sem duplicar jobs.
## 7. Catálogo, categorias e Ofertas Relâmpago

### 7.1 Catálogo operacional

### Estado atual

**Parcial.** Há `ProductLead`, snapshots, API de produtos e tela `apps/dashboard/app/produtos/page.tsx`. O dashboard atual já navega produtos, mas a auditoria não encontrou evidência de cobertura completa do contrato operacional abaixo.

O MVP deve manter **todos os produtos capturados navegáveis** e, quando os dados existirem, mostrar:

- imagem;
- nome;
- categoria;
- preço atual e preço anterior/referência quando disponível;
- desconto;
- comissão;
- score;
- vendas;
- avaliação;
- origem/provider;
- snapshot/revisão/fingerprint relevante;
- status comercial;
- já enviado ou não;
- destinos e histórico de publicação.

Filtros combináveis mínimos: categoria, desconto, score, preço/faixa, comissão, mais vendidos, ainda não enviados, disponibilidade e data de captura.

### 7.2 Categorias Shopee

### Estado atual

**Fundação presente; taxonomia operacional completa ainda não DONE.**

Evidências atuais:

- `docs/shopee-affiliate.md` documenta `productCatIds` no `productOfferV2` oficial;
- banco persiste `categoryIds String[]`;
- niche matching usa `categoryIds`;
- official catalog CLI/service aceita `categoryId`;
- repositories já aceitam filtro por categoryId.

O MVP deve persistir/mapear a taxonomia real do provider e permitir produtos por categoria no painel. Não deve reduzir a Shopee a uma enumeração hardcoded pequena. Uma camada de nomes amigáveis pode existir, mas deve mapear IDs reais e admitir expansão sem regra nova para cada categoria.

### 7.3 Ofertas Relâmpago

### Estado atual

**NOT_STARTED como classificação confiável.**

O contrato oficial documentado hoje expõe preço, desconto, período da oferta, comissão, vendas, categoria etc., mas a auditoria não encontrou campo inequívoco `flashDeal`/tipo de promoção equivalente. O texto `#OfertaRelampago` existente em templates legados de copy **não é evidência do provider** e não pode classificar produto.

Antes de implementar a área **OFERTAS RELÂMPAGO**, a integração oficial deve provar um sinal confiável por campo/tipo/endpoint oficial. Se não houver sinal, a área deve permanecer indisponível ou declarar “não suportado pelo provider”; desconto alto isolado não é critério válido.

## 8. Envio manual

### Estado atual

**NOT_STARTED como feature do painel.** `docs/dashboard-design.md` afirma explicitamente que a versão atual não possui ação de SEND manual. CLIs e serviços técnicos de pipeline não equivalem a um fluxo de produto para o proprietário.

### Requisito oficial

Fluxo:

`filtrar/listar produtos -> selecionar produto -> selecionar grupo(s) autorizado(s) -> preparar/reutilizar copy -> validar -> publicar`.

O envio manual deve reutilizar o **mesmo** pipeline seguro do automático: provenance, snapshot/link, copy/cache/validator, imagem/draft, policy/quota, dedupe, reservation, dispatch, outbox, Sender, idempotência, finalizer e histórico.

Não criar endpoint direto de send para o painel e não permitir retry cego após resultado externo incerto.

## 9. Painel operacional

### Estado atual

**Parcial e predominantemente observacional.** Existem páginas para visão geral, envios, fila, produtos, campanhas, automação, WhatsApp, copies e pipelines. `docs/dashboard-design.md` registra que campanhas/grupos são somente leitura e que não existem controles para editar `.env`, cron, limites/retries ou envio manual.

Essa documentação continua válida como descrição histórica da console atual, mas está **desatualizada como definição do MVP final**, porque o MVP oficial exige administração operacional.

### Painel exigido pelo MVP

#### Números

- instâncias cadastradas;
- conexão/status/health;
- ativo/inativo;
- pausa individual;
- horário inicial/final;
- intervalo;
- limite;
- grupos atribuídos.

#### Grupos

- destino/fingerprint;
- nicho/categorias;
- campanha;
- instância(s) responsáveis;
- ativo/inativo;
- pausa quando aplicável;
- limites e intervalo.

#### Automação

- ligada/pausada globalmente;
- janela operacional;
- agenda calculada;
- próximo envio e último envio;
- instância/número escolhido;
- grupo;
- candidate/produto;
- blocker atual com código/explicação;
- recovery/investigationRequired quando existir.

#### Catálogo

- produtos/snapshots;
- categorias/filtros;
- Ofertas Relâmpago somente com sinal oficial;
- histórico/destinos;
- ação de envio manual segura.

A operação ordinária não pode depender de consultas manuais a PostgreSQL, Redis ou BullMQ.
## 10. Fases concluídas

`DONE` é usado somente quando há contrato e evidência proporcional; existência de código isolada não basta.

### Fase 1 — Identidade e snapshot de produto
- **Estado:** `DONE`
- **Objetivo:** identidade estável do produto/variante e snapshots comerciais versionados.
- **Evidência principal:** `docs/phase-1-product-identity.md`; schema/repositories e testes de identidade/integração.
- **Dependências:** provider Shopee e persistência.
- **Critério objetivo:** mesma identidade não duplica produto; mudança comercial pode criar revisão; conflito/incompletude falha fechado.

### Fase 2 — Filtros, scoring, ranking e fila determinística
- **Estado:** `DONE`
- **Objetivo:** transformar catálogo elegível em candidates ranqueados deterministicamente.
- **Evidência principal:** `docs/phase-2-selection-contract.md`; `commercial-promotion-ranking.test.ts`, mining/service/repository tests; score `official-v2` documentado.
- **Dependências:** Fase 1.
- **Critério objetivo:** filtros/scoring/ranking determinísticos e fila respeita `rankPosition`; copy pronta não promove candidate pior ranqueado.

### Fase 3 — Fairness, nicho e seleção multi-grupo lógica
- **Estado:** `DONE` para o contrato de seleção, não para a operação real multi-grupo final.
- **Objetivo:** ordenar targets com fairness sem reranquear produtos.
- **Evidência principal:** `docs/phase-3-fairness-selection.md` e `docs/phase-7-destinations-publication-policies.md`; testes de ordem/permutação/fairness.
- **Dependências:** Fase 2.
- **Critério objetivo:** ordem de grupos estável, histórico SENT influencia fairness e candidate mantém ranking da campanha.

### Fase 4 — Affiliate link provenance
- **Estado:** `DONE`
- **Objetivo:** provar coerência entre link, produto e snapshot usados para publicação.
- **Evidência principal:** `docs/phase-4-affiliate-link-provenance.md`; `commercial-affiliate-link-provenance.test.ts`; gates integrados no candidate flow/copy.
- **Dependências:** Fases 1–3.
- **Critério objetivo:** mismatch de product/snapshot/revision/fingerprint/link bloqueia antes de geração/SEND.

### Fase 5 — Copy V10 e geração/cache/validação
- **Estado:** `DONE`
- **Objetivo:** gerar ou reutilizar copy sob contrato de validação e tentativas.
- **Evidência principal:** `commercial-ai-copy-prompt-provider.test.ts`, `commercial-ai-copy-validator.test.ts`, `commercial-promotion-copy-generation-service.test.ts`, assembler/DB/routes/CLI tests; Fase 7 referencia a cadeia certificada 1–6 e Copy V10; Fase 11 provou geração OpenAI única e reutilização.
- **Dependências:** provenance/contexto válido.
- **Critério objetivo:** copy inválida não avança; terminal rejection persiste/dedupa; copy válida pode ser reutilizada sem nova chamada provider.

### Fase 6 — Imagem e CommercialMessageDraft
- **Estado:** `DONE`
- **Objetivo:** montar payload final com copy/link/imagem seguros antes da publicação.
- **Evidência principal:** `commercial-message-draft-service.test.ts`, preview CLI e integração no candidate flow; Fase 7 toma `certified CommercialMessageDraft` como input concluído.
- **Dependências:** Fases 4–5.
- **Critério objetivo:** mídia/link inválidos bloqueiam antes de dispatch; draft não altera ranking/target.

### Fase 7 — Destinos, quotas, intervalos e policy
- **Estado:** `DONE`
- **Objetivo:** fechar a fronteira de seleção/policy antes do dispatch.
- **Evidência principal:** `docs/phase-7-destinations-publication-policies.md`; policy/orchestrator/candidate-flow tests.
- **Dependências:** Fases 1–6.
- **Critério objetivo:** grupo autorizado por fingerprint/instance, target determinístico, janela/quota/cooldown/reservation fail-closed e no máximo um target confirmado por tick.

### Fase 8 — Dispatch, outbox, Sender e lifecycle
- **Estado:** `DONE`
- **Objetivo:** boundary idempotente de publicação e resultado terminal.
- **Evidência principal:** `docs/phase-8-dispatch-outbox-sender-lifecycle.md`; `sender-service.test.ts`, dispatch/outbox repository/publisher tests, pipeline/finalizer tests.
- **Dependências:** Fase 7.
- **Critério objetivo:** dispatch/outbox únicos, uma tentativa nos boundaries críticos, SENT/FAILED/AMBIGUOUS coerentes e finalização idempotente.

### Fase 9 — E2E no-SEND
- **Estado:** `DONE`
- **Objetivo:** provar a cadeia integrada sem efeito externo real.
- **Evidência principal:** `docs/phase-9-e2e-no-send.md` e `apps/worker/test/commercial-e2e-no-send.integration.test.ts`; regressão continuou verde no hardening pós-piloto.
- **Dependências:** Fases 1–8.
- **Critério objetivo:** E2E chega ao boundary esperado, preserva lifecycle/dedupe e não envia mensagem real.

### Fase 10 — Runtime, scheduler, recovery e normalização
- **Estado:** `DONE` como fundação de runtime.
- **Objetivo:** alinhar runtime comercial, scheduler/worker, recovery e configuração aos contratos certificados.
- **Evidência principal:** `docs/phase-10-runtime-normalization.md`; scheduler status/routes, orchestrator, recovery e worker tests.
- **Dependências:** Fase 9.
- **Critério objetivo:** runtime executa tick com policy/reservation/recovery fail-closed e pode permanecer pausado/quiescente em gates controlados.

### Fase 11 — Primeiro SEND real e hardening pós-piloto
- **Estado:** `DONE`
- **Objetivo:** comprovar um SEND real único e corrigir falhas descobertas no boundary real.
- **Evidência principal:** certificação operacional de 2026-08-18 e hardening presente na `main`:
  - execution `cmsyknjpn0000jqqxyzqjzk8v`;
  - run `cmsyknju20001jqqxpkbkhogx`;
  - dispatch `commercial-cmsyknju20001jqqxpkbkhogx-dispatch`;
  - candidate `cmsmgt296000q21636718iwyn`;
  - generatedCopy `cmsy12dl70005t5ddkydl360k`;
  - dispatch `SENT`, `attemptCount=1`, externalMessageId presente, run `SENT`, candidate `DISPATCHED`, outbox `PUBLISHED`, reservation liberada e ambiguity `0`;
  - `main` contém o fix que preserva `this` em `runs.findExecutionById`, `promotionCandidates.findAttemptContextByGeneratedCopyId` e `promotionCandidates.releaseAttempt`.
- **Dependências:** Fases 1–10.
- **Critério objetivo:** exatamente um SEND real sem duplicidade, estado final consistente, runtime quiescente e hardening mergeado.

## 11. Fases concluídas recentemente

### Fase 12 — Estabilidade controlada multiciclo
- **Estado:** `DONE`
- **Objetivo:** provar múltiplos ciclos reais sucessivos respeitando ranking, provenance, cooldown, quota, dedupe e recovery.
- **Evidência histórica:** a tentativa operacional de 2026-08-18 encerrou `SAFETY_STOP` antes de novo SEND ao encontrar o próximo candidate determinístico stale:
  - candidate `cmsmhccp1000bfjofyoo56298`;
  - blocker `COMMERCIAL_AI_COPY_AFFILIATE_LINK_SNAPSHOT_MISMATCH`;
  - refresh oficial Shopee executado porque havia drift real, mas mining normal reportou `queuedUpdated=0` e `queuedExpired=0`;
  - o mesmo candidate permaneceu bloqueado no preflight;
  - novos SENDs da Fase 12: `0`;
  - ambiguity `0`, reservations `0`, runtime quiescente.
- **Evidência final certificada em 2026-08-22:**
  - `CLEAN_CYCLE_1_CERTIFIED=true`, execution `cmt4cn72d0000tolk6fpqvehr`, run `cmt4cnag6000dtolkus9h6g4x`, dispatch `SENT`/`attemptCount=1`, candidate `DISPATCHED`/`rankPosition=1`, outbox `PUBLISHED`, job `completed`/`attemptsMade=1`, reservation liberada, retry/requeue/manualRecovery `0` e duplicidade `0`;
  - `CLEAN_CYCLE_2_CERTIFIED=true`, execution `cmt4k4z6700002d9qtm420aai`, run `cmt4k52ef000d2d9q2c2b9foi`, candidate `cmsz7ly6a0004wddavartw3zj` `DISPATCHED`/`rankPosition=1`, dispatch `SENT`/`attemptCount=1`, outbox `PUBLISHED`, job `completed`/`attemptsMade=1`, reservation liberada, retry/requeue/manualRecovery `0` e duplicidade `0`;
  - os dois ciclos foram independentes e one-shot, com ranking pós-sync, provenance, quotas e minimum interval preservados;
  - a reconciliação stale foi incorporada por contrato na `main` por `958de84` (seleção determinística pós-sync), `8374ca5` (rejeição de snapshot stale) e `bd13d7c` (skip de candidate com rejeição terminal), preservando histórico terminal; o candidate histórico `cmsmhccp1000bfjofyoo56298` terminou `BLOCKED`, `rankPosition=null`, `blockedReason=QUEUE_NOT_SELECTED` e `generatedCopyId=null`.
- **Cooldown fail-closed certificado:** a execution `cmt4jgck00000146ypj9rewmz` terminou `BLOCKED` por `MINIMUM_INTERVAL_NOT_REACHED`, com `externalStage=NOT_REACHED` e `commercialRunId=null`; esse tick não criou run, dispatch, outbox ou BullMQ SEND job e teve `Shopee=0`, `OpenAI=0`, `Evolution SEND=0` e `WhatsApp SEND=0`. O `minimumIntervalMinutes` observado foi `14`, bloqueando antes da fronteira externa.
- **Estado global final certificado:** `activeExecutions=0`, `activeReservations=0`, `ambiguousRuns=0`, `investigationRequired=0`, `pendingDispatches=0` e `pendingOutboxes=0`; as filas `whatsapp-dispatch` e `commercial-automation` ficaram com `waiting=0`, `active=0` e `delayed=0`. Jobs históricos terminalizados podem permanecer retidos e não são blockers quando não estão nesses estados.
- **Dependências:** Fase 11.
- **Critério objetivo:** corrigir por contrato a reconciliação de queued candidate stale sem skip oportunista; concluir pelo menos dois novos ciclos reais; todos dispatches SENT/attemptCount=1; candidates DISPATCHED; outboxes PUBLISHED; reservations liberadas; `duplicateSend=0`; `ambiguousState=0`; quotas e minimum interval preservados.

**A Fase 12 está certificada como concluída.** As fases seguintes permanecem planejadas e não iniciadas, e `PROJECT_DONE` ainda não foi declarado.
## 12. Fases restantes

As fases abaixo consolidam o caminho mínimo até o MVP oficial. Podem ser subdivididas em PRs/microtarefas, mas uma fase só muda de estado quando seu critério objetivo for atendido.

### Fase 13 — Reconciliação de catálogo/candidate e fechamento multiciclo
- **Estado:** `NOT_STARTED` como hardening específico; dependência imediata da Fase 12.
- **Objetivo:** reconciliar candidates queued quando `ProductLead` avança snapshot/revision/fingerprint, preservando ranking e sem usar candidate stale.
- **Evidência principal:** blocker real da Fase 12 após refresh oficial.
- **Nota de transição:** parte da mitigação de stale candidate que motivou esta fase foi incorporada durante o hardening da Fase 12; o status permanece `NOT_STARTED` e o escopo deve ser revalidado antes da execução.
- **Dependências:** contratos de snapshot/provenance das Fases 1 e 4.
- **Critério objetivo:** regressão reproduz drift; sync/mining atualiza/expira/recria candidate corretamente; ranking não é burlado; preflight volta a provenance válida; Fase 12 fecha com dois novos SENDs reais.

### Fase 14 — Multi-instância e multi-grupo real
- **Estado:** `NOT_STARTED`
- **Objetivo:** remover a premissa operacional de uma única `EVOLUTION_INSTANCE_NAME` e operar N instâncias/grupos com assignments persistidos.
- **Evidência principal:** destino possui `sourceInstanceName`, mas runtime/config principal é singular e não há certificação real multi-número.
- **Dependências:** Fase 13 estável; lifecycle atual preservado.
- **Critério objetivo:** pelo menos duas instâncias em teste/integração real controlada; assignments persistidos; pausa/falha de uma não redireciona silenciosamente outra; nicho/dedupe corretos por grupo; múltiplos grupos reais recebem candidates compatíveis.

### Fase 15 — Scheduler multi-instância, cadence e stagger
- **Estado:** `NOT_STARTED`
- **Objetivo:** produzir agenda com horários por instância e espaçamento entre grupos.
- **Evidência principal:** scheduler/cooldown existem, mas não há stagger configurável nem agenda N-instâncias certificada.
- **Dependências:** Fase 14.
- **Critério objetivo:** agenda respeita janela/intervalo/quotas; stagger evita rajadas; restart não duplica jobs; painel altera horários/intervalos sem `.env`; soak mostra sequência prevista entre grupos/instâncias.

### Fase 16 — Catálogo operacional, taxonomia Shopee e Ofertas Relâmpago
- **Estado:** `NOT_STARTED` como experiência completa; fundações já existem.
- **Objetivo:** transformar catálogo persistido em ferramenta operacional completa.
- **Evidência principal:** ProductLead/snapshots/categoryIds e página Produtos existem; UX/filtros/histórico estão incompletos; não há sinal confiável documentado de flash deal.
- **Dependências:** provider oficial e modelo de catálogo atuais.
- **Critério objetivo:** todos os produtos capturados navegáveis; campos/filtros mínimos da seção 7; categorias reais mapeadas e filtráveis; histórico de destinos/envios; Ofertas Relâmpago habilitadas só após prova de sinal oficial e teste de mapeamento, ou explicitamente indisponíveis se o provider não suportar.

### Fase 17 — Envio manual seguro pelo mesmo pipeline
- **Estado:** `NOT_STARTED`
- **Objetivo:** permitir publicação iniciada pelo proprietário sem segundo boundary de SEND.
- **Evidência principal:** dashboard atual proíbe manual SEND; pipeline seguro já existe e deve ser reutilizado.
- **Dependências:** Fases 13–16.
- **Critério objetivo:** produto/grupos selecionados no painel atravessam provenance/copy/draft/policy/dedupe/reservation/dispatch/outbox/Sender/finalizer; idempotency key impede duplo clique/retry duplicado; ambiguous result bloqueia nova tentativa automática.

### Fase 18 — Painel de configuração e observabilidade operacional
- **Estado:** `NOT_STARTED` como administração completa; dashboard observacional é uma base.
- **Objetivo:** controlar números, grupos, automação, catálogo e blockers sem DB/Redis/BullMQ.
- **Evidência principal:** console atual possui páginas/polling, mas campanhas/grupos são read-only e faltam controles persistidos do MVP.
- **Dependências:** modelos/config APIs das Fases 14–17.
- **Critério objetivo:** proprietário cadastra/ativa/pausa instâncias e grupos, atribui rotas, configura horários/intervalos/limites/stagger, vê próximo/último envio/blocker e usa catálogo/manual SEND sem shell/DB.
### Fase 19 — Recovery/restart e autonomia contínua
- **Estado:** `NOT_STARTED` como certificação final; mecanismos de recovery já existem.
- **Objetivo:** provar operação autônoma contínua sob scheduler recorrente, restart e falhas comuns.
- **Evidência principal:** recovery unit/integration e Fases 9–11 cobrem boundaries isolados; ainda não há soak completo multi-instância/multi-grupo.
- **Dependências:** Fases 13–18.
- **Critério objetivo:** restart reconcilia jobs/leases/outboxes sem duplicar; provider ambiguity para sem retry perigoso; instância indisponível fica visível sem reroute indevido; múltiplas janelas/ciclos completam com `duplicateSend=0` e ambiguity pendente `0`; scheduler/worker não duplicam.

### Fase 20 — Certificação PROJECT_DONE
- **Estado:** `NOT_STARTED`
- **Objetivo:** certificar o MVP completo em cenário real representativo.
- **Evidência principal:** a produzir após Fase 19.
- **Dependências:** todas as fases anteriores.
- **Critério objetivo:** satisfazer integralmente a seção 13 e produzir relatório reproduzível com `agenda -> seleção -> SEND -> lifecycle -> próximo ciclo` operável pelo painel.

## 13. Critério `PROJECT_DONE`

`PROJECT_DONE=true` somente quando todos os itens forem verdadeiros ao mesmo tempo:

1. **Agenda autônoma:** scheduler recorrente único executa a agenda sem ação humana ordinária.
2. **Número correto:** cada envio usa a instância atribuída/saudável; várias instâncias operam simultaneamente.
3. **Grupo correto:** target autorizado, ativo, disponível e coerente com campanha/nicho/assignment.
4. **Produto correto:** próximo candidate determinístico elegível, compatível com nicho e não já entregue ao destino.
5. **Provenance correta:** product/snapshot/revision/fingerprint/affiliate link coerentes no momento da publicação.
6. **Copy/imagem válidas:** copy é reutilizada ou gerada uma vez quando necessário; imagem/draft passam gates.
7. **Envios espaçados:** stagger/cooldown/janela/quotas respeitados; nenhuma rajada indevida.
8. **Boundary seguro:** dispatch/outbox/Sender únicos; attempts críticos = 1; sem retry após possível efeito externo.
9. **Lifecycle terminal:** execution/run/dispatch/outbox/candidate/reservation terminam coerentes ou entram em investigação explícita fail-closed.
10. **Dedupe:** `duplicateSend=0`; dedupe por grupo/destino preservado.
11. **Recovery:** restart/falhas não duplicam mensagens nem exigem limpeza manual rotineira.
12. **Próximo ciclo:** após envio terminal, o sistema agenda/executa naturalmente o próximo elegível.
13. **Painel suficiente:** proprietário opera números, grupos, agenda, catálogo, blockers e envio manual sem consultar PostgreSQL/Redis/BullMQ no fluxo normal.
14. **Soak representativo:** múltiplos ciclos reais em mais de um grupo e mais de uma instância completam sem intervenção ordinária, duplicidade ou ambiguity pendente.

Sequência mínima observável no certificado final:

`agenda -> número correto -> grupos atribuídos -> produto adequado ao nicho -> copy/imagem/link válidos -> envios espaçados -> lifecycle terminal -> próximo ciclo`.

Até isso ser comprovado, o projeto pode estar tecnicamente avançado, mas não está `PROJECT_DONE`.

## 14. Pós-MVP explicitamente separado

Não bloqueiam `PROJECT_DONE`, salvo decisão futura explícita:

- SaaS multiusuário/tenancy;
- cobrança, planos e billing;
- aplicativo mobile nativo;
- analytics avançado, attribution/BI sofisticado;
- experimentação A/B automatizada de copy;
- otimização preditiva avançada de horário/conversão;
- outros marketplaces/providers além da Shopee;
- HA/distribuição geográfica além do necessário para uso próprio;
- RBAC complexo além do proprietário único;
- CRM/funil externo ao lifecycle de publicação.

## Resumo executivo de status

| Área | Estado atual | Leitura correta |
|---|---|---|
| Identidade/snapshot | DONE | Base certificada |
| Filtros/scoring/ranking | DONE | Determinístico |
| Fairness/nicho | DONE no core | Multi-grupo real ainda precisa certificação |
| Provenance | DONE | Fail-closed; revelou blocker real na Fase 12 |
| Copy V10 | DONE | Geração/cache/validator provados |
| Imagem/draft | DONE | Gate antes de dispatch |
| Policy/destinos | DONE | Runtime atual ainda centrado em uma instância configurada |
| Dispatch/outbox/Sender | DONE | Primeiro SEND real concluído |
| E2E no-SEND | DONE | Regressão preservada |
| Runtime/recovery base | DONE | Ainda falta autonomia contínua final |
| Primeiro SEND real | DONE | Fase 11 certificada |
| Estabilidade multiciclo | DONE | Dois ciclos reais certificados; stale candidate reconciliado sem bypass |
| Multi-instância real | NOT_STARTED | Requisito de MVP |
| Multi-grupo real completo | NOT_STARTED | Core existe; operação/configuração não certificada |
| Scheduler/stagger final | NOT_STARTED | Cooldown existe; stagger/N-instâncias não |
| Catálogo operacional completo | NOT_STARTED | Tela/modelo existentes, UX final não |
| Categorias reais no painel | NOT_STARTED | IDs persistidos; taxonomia/UX final não |
| Ofertas Relâmpago confiáveis | NOT_STARTED | Sem sinal oficial comprovado hoje |
| Envio manual seguro | NOT_STARTED | Deve reutilizar pipeline atual |
| Painel administrativo | NOT_STARTED | Console atual predominantemente read-only |
| Soak/restart/autonomia | NOT_STARTED | Gate final do MVP |
