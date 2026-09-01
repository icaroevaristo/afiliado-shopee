# AGENTS.md

## Visao geral

Este documento descreve os agentes e componentes de orquestracao atuais do projeto. O estado atual mantem implementacoes locais e mocks como padrao seguro; Evolution API requer selecao e configuracao explicitas.

## Camadas de aplicacao e persistencia

- Servicos de aplicacao: `HunterService`, `ScoreService`, `CopyService`, `SenderService`, `PipelineService` e `AnalyticsService`.
- Contratos de repositorio: `ProductRepository`, `GeneratedCopyRepository`, `WhatsAppDestinationRepository`, `WhatsAppGroupDirectoryRepository`, `WhatsAppDispatchRepository` e `AnalyticsRepository`.
- Adaptadores Prisma: `PrismaProductRepository`, `PrismaGeneratedCopyRepository`, `PrismaWhatsAppDestinationRepository`, `PrismaWhatsAppGroupDirectoryRepository`, `PrismaWhatsAppDispatchRepository` e `PrismaAnalyticsRepository`.
- Composicao: `createApplicationServices` e `createPrismaRepositories` em `apps/api/src/application-services.ts`.
- Ofertas Shopee: `ShopeeOfferSyncService`, `ShopeeOfferRepository`,
  `PrismaShopeeOfferRepository`, `CouponService` e `CopyPreviewService`.

Regra: agentes e servicos de aplicacao nao dependem diretamente do Prisma Client. Prisma fica restrito aos adaptadores concretos.

## Historico Prisma e baseline legada

- `0_legacy_baseline` reconstrói somente `ProductLead` e `GeneratedCopy` como
  existiam antes da primeira migration versionada; migrations posteriores
  permanecem byte a byte inalteradas.
- Instalacoes novas validam o histórico com `db:migrations:verify-clean` e usam
  `db:deploy` normalmente.
- Bancos criados antes da baseline consultam `db:baseline:status` e executam
  uma unica vez `db:baseline:adopt -- --confirm-existing-database` antes do
  deploy. A adoção registra apenas o histórico Prisma e não executa SQL
  estrutural nem modifica tabelas comerciais.

## Shopee Affiliate Offers

Responsabilidade:

- Listar ofertas por contrato independente de banco e transporte.
- Sincronizar um lote limitado, validar, deduplicar por origem + ID, criar ou
  atualizar `ProductLead` e ignorar expirados.
- Validar/importar registros manuais sem consultar páginas de produto.
- Expor catálogo e preview de copy sem gerar copy persistida, dispatch ou job.

Providers:

- `MockShopeeAffiliateOfferProvider`: determinístico, `example.invalid`, sem
  internet, com filtros/paginação e campos opcionais ausentes.
- `ManualShopeeAffiliateOfferProvider`: exige dados completos, URLs HTTP/HTTPS
  e `affiliateLink` informado pelo usuário; preserva origem `MANUAL`.
- `OfficialShopeeAffiliateOfferProvider`: usa signer SHA-256 puro e transport
  GraphQL com clock/fetch injetáveis, timeout, abort, resposta limitada e erros
  sanitizados. Sem configuração retorna `SHOPEE_API_NOT_CONFIGURED`; a URL é
  restrita ao endpoint oficial confirmado.

Persistência:

- `ProductLead` usa origem `MOCK`, `MANUAL` ou `OFFICIAL` e unique composta com
  `providerProductId`.
- Preços e valores monetários novos usam `Decimal`; o domínio usa strings
  decimais. Atualizações preservam IDs, copies e dispatches.
- `lastSeenAt` é atualizado; produtos não são apagados automaticamente.
- Ofertas `OFFICIAL` usam `CommercialOfferSnapshot` para registrar somente
  mudanças de preço, desconto, comissão, vigência ou indisponibilidade. O
  `ProductLead` guarda a revision e o fingerprint do último snapshot.
- O upsert oficial atualiza produto, revision, fingerprint e snapshot na mesma
  transação. Estados A → B → A produzem revisions 1, 2 e 3; observações
  consecutivas iguais não duplicam snapshot. Rating e vendas são capturados no
  snapshot criado, mas mudanças isoladas nesses campos não abrem revision.
- `capturedAt` usa o `fetchedAt` observado, enquanto revision representa uma
  mudança comercial e não a quantidade de sincronizações.
- O baseline local é explícito e idempotente por
  `commercial:snapshots:backfill`; não chama a Shopee, não usa fila e processa
  somente produtos `OFFICIAL` ainda na revision zero.

Segurança operacional:

- O sync não recebe dependências de Copy, BullMQ, Pipeline, Scheduler ou
  WhatsApp.
- O sync e o backfill de snapshots não executam mineração. A mineração comercial
  consome somente produtos e snapshots `OFFICIAL` já persistidos.
- O sync oficial controlado exige preflight, uma flag exata, no máximo uma
  página/cinco produtos e um marcador local que bloqueia repetição.
- As duas leituras reais da Sprint 18.1 foram consumidas. A segunda retornou
  HTTP 200 com erro público `10020` (`Invalid Credential`), sem dados ou
  produtos persistidos; uma terceira leitura permanece bloqueada.
- Importação CLI é dry-run por padrão e grava somente com `--confirm-import`.
- `official` nunca inventa assinatura, headers, URL GraphQL ou rate limit.
- Sub_ids são metadados separados; links manuais nunca são alterados.
- Scraping e endpoints privados/mobile são proibidos. A única automação de
  navegador permitida é a captura documental local, efêmera e sanitizada nos
  dois hosts oficiais; ela bloqueia POST GraphQL e não persiste credenciais,
  storage, cookies, HAR, headers brutos ou screenshots.

## Coupons

`CouponService` mantém CRUD local confirmado para cupons manuais. Cupom
inativo, vencido, ainda não iniciado ou abaixo da compra mínima é inelegível.
Sem valor de compra, não existe cálculo de preço final. Não há coleta oficial e
cupons não entram automaticamente em copy.

## Runtime ESM dos componentes

- API e worker executados por `tsx` usam obrigatoriamente
  `tsconfig.runtime.json` na raiz.
- O arquivo de runtime resolve `config`, `database`, `providers`, `queue`,
  `shared` e `agents` para seus `src/index.ts`.
- Os tsconfigs de build podem apontar tipos para `dist/index.d.ts`, mas uma
  declaracao `.d.ts` nunca pode ser usada como modulo em execucao.
- Pacotes compilados continuam ESM por `type: "module"` e resolvem JavaScript
  em `dist/index.js`; nao existem imports relativos cruzando pacotes.
- O smoke `corepack pnpm test:runtime` inicia a API com ambiente mock,
  Scheduler desativado e porta livre, valida `GET /health` com HTTP 200, garante
  que o processo permaneceu ativo e o encerra.
- O comando leigo suportado e
  `corepack pnpm --filter @shopee-auto-affiliate-ai/api dev`, sem build manual e
  sem pnpm global.
- Suporte minimo: Node.js 20.6. O runtime foi validado no Node.js 24.15.0 e
  `tsx` 4.23.1.

## Hunter

Responsabilidade:

- Buscar produtos a partir de filtros comerciais.
- Persistir novos produtos em `ProductLead`.
- Atualizar produtos existentes pelo `providerProductId`.

Entradas:

- `ProductFilters` com campos opcionais como `categoria`, `precoMin`, `precoMax`, `descontoMin`, `notaMin`, `vendidosMin` e `comissaoMin`.
- Provider compatvel com `HunterProvider`.

Saidas:

- Contagem de produtos encontrados.
- Contagem de produtos novos.
- Contagem de produtos atualizados.
- Tempo de execucao.
- Registros criados ou atualizados em `ProductLead`.

Dependencias:

- `HunterService` em `apps/api/src/hunter-service.ts`.
- `HunterProvider` e `MockShopeeProvider` em `packages/providers`.
- `ProductRepository`.
- Adaptador Prisma apenas na composicao.
- Tipos compartilhados em `packages/shared`.

Proximos passos previstos:

- Substituir ou complementar `MockShopeeProvider` por provider real quando a sprint de integracao for definida.
- Fortalecer validacao de filtros com schemas formais.
- Adicionar observabilidade especifica para origem, categoria e volume de produtos.

## Score

Responsabilidade:

- Calcular score matematico de 0 a 100 para produtos persistidos.
- Atualizar `score` e `scoreUpdatedAt` em `ProductLead`.
- Retornar estatisticas agregadas da execucao atual.

Entradas:

- Produtos salvos em `ProductLead`.
- Campos comerciais usados no calculo: comissao, nota, vendidos, desconto e loja.

Saidas:

- Score persistido por produto.
- Quantidade de produtos processados.
- Maior score, menor score e media.
- Tempo de execucao.

Dependencias:

- `ScoreService` em `apps/api/src/score-service.ts`.
- `ProductRepository`.
- Adaptador Prisma apenas na composicao.
- Pesos matematicos locais.
- Testes de score em `apps/api/test/score.test.ts` e `packages/agents/src/score.test.ts`.

Proximos passos previstos:

- Documentar formalmente qualquer alteracao futura de pesos antes de modificar o calculo.
- Avaliar criterios adicionais somente em sprint especifica.
- Criar migracoes Prisma formais quando o fluxo de migracoes for consolidado.

## Copy

Responsabilidade:

- Gerar textos promocionais para produtos existentes.
- Usar templates locais e placeholders.
- Persistir uma nova linha em `GeneratedCopy` a cada geracao.

Entradas:

- `productId` de um produto existente.
- Dados do produto: nome, categoria, preco, desconto, nota e comissao.
- Templates definidos localmente.

Saidas:

- `titulo`.
- `mensagem`.
- `cta`.
- `hashtags`.
- Registro em `GeneratedCopy`.

Dependencias:

- `CopyService` e `TemplateEngine` em `apps/api/src/copy-service.ts`.
- `ProductRepository`.
- `GeneratedCopyRepository`.
- Modelo `GeneratedCopy`.
- Testes de copy em `apps/api/test/copy.test.ts`.

Proximos passos previstos:

- Adicionar templates apenas por sprint dedicada.
- Manter este `CopyService` legado restrito a templates; a geracao por IA de
  candidatos comerciais usa o servico isolado descrito ao fim deste arquivo.
- Melhorar selecao de template se houver criterios de categoria, score ou canal.

## Sender

Responsabilidade:

- Montar mensagem publica a partir da copy gerada.
- Processar um `WhatsAppDispatch`.
- Adquirir atomicamente somente dispatch `PENDING`, incrementar tentativas,
  chamar provider de WhatsApp e atualizar status.
- Marcar `SENT` apenas depois da persistencia do resultado, `FAILED` somente
  quando o provider prova que nenhum request externo iniciou e conservar
  `PROCESSING` quando a entrega pode ter ocorrido.

Entradas:

- `dispatchId`.
- Registro `WhatsAppDispatch` com relacoes para copy e destino.
- Provider compatvel com `WhatsAppProvider`.

Saidas:

- `WhatsAppDispatch` atualizado.
- `externalMessageId` mockado quando enviado.
- `sentAt` quando enviado.
- `errorMessage` quando houver falha.

Dependencias:

- `SenderService` em `apps/api/src/sender-service.ts`.
- `MockWhatsAppProvider` em `packages/providers`.
- `WhatsAppSendError` em `packages/providers`, que informa se a entrega pode
  ter iniciado sem expor resposta ou payload externo.
- `EvolutionApiWhatsAppProvider` em `packages/providers`, injetado no sender pelo bootstrap quando selecionado.
- `EvolutionSendGuard` em `packages/providers`, criado uma vez para Evolution e
  responsavel por allowlist exata e limite de requests por processo.
- CLI `evolution-single-message-test.ts` em `apps/worker`, isolado do Sender,
  dispatches, filas e banco e em dry-run por padrao.
- Factory `createWhatsAppProvider`, com `mock` como selecao padrao segura.
- Bootstrap `startWorker` em `apps/worker/src/index.ts`, ponto unico de selecao e injecao do provider.
- `WhatsAppDispatchRepository`.
- Fila `whatsapp-dispatch` em `packages/queue`.
- Worker em `apps/worker`.
- Modelos `WhatsAppDestination` e `WhatsAppDispatch`.

Proximos passos previstos:

- Revisar explicitamente ambiente, instancia e destino controlado antes de
  qualquer uso futuro da flag de envio unico.
- Validar a integracao Evolution em ambiente controlado antes de qualquer ativacao em producao.
- Adicionar autenticacao, autorizacao e controles operacionais antes de producao.
- Criar fluxo de reprocessamento manual para falhas.

Protecoes Evolution atuais:

- O endpoint `sendText` da Evolution API 2.3.7 local usa somente o payload
  plano `{ number, text }`; nao ha fallback automatico para `textMessage`, pois
  uma segunda tentativa poderia duplicar uma entrega.
- Safe mode ativo por padrao, allowlist vazia bloqueando todos os destinos e
  limite padrao de um request iniciado por processo.
- Destinos comparados apos normalizacao de formatacao, sempre por igualdade
  completa.
- Timeout e erro HTTP contam porque o request foi iniciado; bloqueios antes do
  HTTP nao contam.
- Timeout, erro de rede/HTTP ou falha ao persistir `SENT` deixam o dispatch em
  `PROCESSING`. Redelivery e concorrencia nao chamam o provider novamente;
  revisao manual e obrigatoria.
- Mock sem guard e sem alteracao de comportamento.
- Esta protecao e o contrato 2.3.7 foram validados com clientes HTTP injetados e
  mocks; testes automatizados nunca chamam a internet.

Fluxo de teste unico:

- `corepack pnpm evolution:test-message` apenas valida e mostra um resumo
  mascarado, sem exigir `pnpm` global no Windows.
- A flag exata `--confirm-one-real-message`, direta ou depois de um unico
  separador `--`, e o unico caminho de envio e permanece bloqueada em CI.
- Safe mode deve estar ativo, a allowlist deve conter exatamente um destino, o
  limite deve ser 1 e o Scheduler deve estar desativado.
- O destino vem somente da allowlist e a mensagem fixa nao usa produto, copy,
  comissao, link, hashtag, pipeline ou `WhatsAppDispatch`.
- O comando nao inicia consumers, nao registra Scheduler e nao acessa Prisma,
  Redis ou BullMQ.
- Logs sao apenas locais e estruturados, sem persistencia, API key, destino
  completo, headers, payload ou resposta externa bruta.
- Timeout, erro de rede, HTTP 5xx ou resultado ambiguo proibem qualquer retry
  manual ou automatico.
- Na Task 13.4, a stack e a instancia estavam saudaveis/conectadas, mas o
  `.env` ignorado selecionava `mock` e tinha allowlist vazia. O dry-run bloqueou
  antes do provider; nenhuma mensagem real foi enviada e nenhum segredo foi
  versionado.

Fluxo E2E de dispatch controlado:

- `corepack pnpm whatsapp:e2e-test` e dry-run por padrao, carrega o `.env` raiz
  sem sobrescrever variaveis de processo e valida Evolution, instancia, banco e
  Redis sem criar registros, jobs ou workers.
- A unica confirmacao aceita e `--confirm-one-real-dispatch`; CI, mock, safe
  mode falso, Scheduler ativo, allowlist diferente de um destino, limite
  diferente de 1 e argumentos adicionais bloqueiam antes do envio.
- O cenario usa IDs deterministas para produto/copy/destino/dispatch/job. O
  destino tecnico permanece inativo e destinos normais nao sao alterados.
- Um dispatch anterior em qualquer estado bloqueia reexecucao. Historico e job
  sao preservados para auditoria e nunca apagados pelo comando.
- O job E2E usa `attempts: 1`, sem backoff e sem remocao automatica. Jobs
  normais preservam tres tentativas, mas o Sender permite chamada externa
  somente apos aquisicao atomica de `PENDING`; `PROCESSING` e `FAILED` nunca
  autorizam reenvio automatico.
- O consumer isolado compoe apenas repositorios, `SenderService`, uma instancia
  de provider/guard e o worker `whatsapp-dispatch`; nao compoe Pipeline, Hunter,
  Score, Copy, Scheduler, API ou dashboard.
- O texto entregue ao provider e a constante fixa da Task 13.5. A copy tecnica
  preserva titulo e mensagem para auditoria, e o message builder E2E evita
  concatenar conteudo adicional no envio real.
- Depois do job, banco e `GET /whatsapp/dispatches/:id` via `app.inject` sao
  comparados. A resposta de detalhe mascara o destino.
- Falha, timeout ou ambiguidade nao reenfileiram e exigem investigacao manual.

Estado sanitizado da preparacao da Task 13.5: Evolution 2.3.6 saudavel,
instancia open e infraestrutura principal disponivel. O `.env` raiz ainda
selecionava mock, instancia de exemplo e allowlist vazia; logo nenhuma mensagem
real foi enviada e nenhum registro E2E foi criado pela execucao local.

## Diretorio de grupos WhatsApp

Responsabilidade:

- Descobrir somente os grupos dos quais a instancia conectada participa.
- Persistir identificador externo apenas no banco e expor fingerprint SHA-256.
- Criar novos grupos inativos, atualizar metadados seguros e desativar grupos
  que ficaram indisponiveis.
- Administrar autorizacao explicita sem criar uma acao de envio.

Dependencias:

- `EvolutionApiGroupDirectoryProvider` e contrato
  `WhatsAppGroupDirectoryProvider` em `packages/providers`.
- `GroupDirectoryService`, `WhatsAppGroupDirectoryRepository` e adaptador Prisma
  em `apps/api`.
- Modelo compartilhado `WhatsAppDestination` com tipo `GROUP` e migracao
  `20260724190000_whatsapp_group_directory`.
- Secao Grupos da pagina WhatsApp do dashboard.

Contrato Evolution 2.3.7:

- Somente `GET /group/fetchAllGroups/:instanceName?getParticipants=false`, com
  header `apikey`, timeout e sem body.
- `getParticipants=false` e obrigatorio. O provider mapeia apenas `id`,
  `subject` e `size`; qualquer campo `participants` recebido e descartado.
- A rota oficial nao tem guard explicito de conexao. Timeout, rede, HTTP
  400/401/403/404/5xx e resposta malformada viram erros locais sanitizados.
- Nenhum endpoint de participante, convite, nome, descricao, configuracao,
  criacao, saida ou envio e usado pelo diretorio.

Autorizacao e anti-mass-send:

- Novo grupo sempre nasce `active=false`; grupo ausente fica
  `available=false` e `active=false` sem ser apagado.
- Ativacao pela API exige `confirm: "AUTORIZAR_GRUPO"`; o dashboard nao altera
  o master switch.
- `WHATSAPP_GROUP_SEND_ENABLED=false` e
  `WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN=1` sao os defaults.
- `PipelineService` recebe somente destinos `INDIVIDUAL`; Scheduler nao cria
  fanout, loop ou broadcast de grupos.
- O Sender exige instancia atual, disponibilidade, autorizacao, identidade
  exata, safe mode e master switch imediatamente antes do provider.
- Telefones continuam usando a allowlist anterior e nunca sao tratados como
  grupos.

Teste controlado:

- `corepack pnpm whatsapp:group-test` valida Evolution, instancia, banco, Redis,
  diretorio e autorizacao em dry-run sem escrita, fila, worker ou envio.
- A unica flag futura e `--confirm-one-real-group-message`; ela foi implementada
  para testes mockados, permanece bloqueada em CI e nao foi executada.
- O caminho futuro exige exatamente um grupo ativo/disponivel, texto e IDs
  fixos, um job com uma tentativa, sem backoff/retry/remocao, worker isolado e
  bloqueio permanente depois de execucao anterior.
- Saidas e logs usam somente contagens, nome permitido e fingerprint; nunca JID,
  participantes, telefone, convite, key, token ou sessao.

Persistencia:

- A migracao nova aplica sobre o banco existente. A validacao de banco limpo
  permanece impedida pela migracao historica de dispatch, que referencia
  tabelas anteriores nao criadas por ela. O primeiro erro reproduzido e Prisma
  `P3018`, PostgreSQL `42P01`, `relation "ProductLead" does not exist`, na
  `20260724000000_whatsapp_dispatch`; nenhuma migracao antiga foi alterada.

Infraestrutura local da Evolution API:

- Compose isolado em `infra/evolution/docker-compose.yml` com Evolution API
  2.3.7, PostgreSQL 16.4 e Redis 7.2.5 em imagens fixadas.
- Rede e volumes possuem prefixo proprio; PostgreSQL e Redis nao publicam
  portas ao host. Somente a API e exposta em `127.0.0.1:8080` por padrao.
- `infra/evolution/.env.local` e gerado com segredos aleatorios, carregado
  explicitamente pelo compose e ignorado pelo Git.
- Healthchecks validam PostgreSQL, Redis e `GET /`, que e o status publico
  suportado pela Evolution API 2.3.7.
- Telemetria opcional, filas/eventos externos, webhooks, chatbots, S3 e
  persistencia de mensagens, contatos e chats ficam desativadas.
- Os scripts `evolution:up`, `evolution:down`, `evolution:status`,
  `evolution:logs` e `evolution:restart` apenas operam containers; nao chamam
  Sender, worker, pipeline, Scheduler ou endpoints da Evolution.
- A stack nao cria instancia, nao gera QR Code, nao conecta WhatsApp e nao envia
  mensagens. Criacao e conexao manuais exigem uma task futura e revisao
  controlada separada.
- A 2.3.7 incorpora a correcao da migracao Kafka publicada na 2.3.5 e nao exige
  ativacao externa obrigatoria, mas sua Apache 2.0 possui
  condicoes adicionais de marca/copyright e aviso de uso; o descumprimento pode
  exigir licenca comercial.

## Pipeline

Responsabilidade:

- Orquestrar Hunter, Score, Copy e Sender por filas.
- Selecionar produtos aprovados por score.
- Criar dispatches para destinos ativos.
- Enfileirar jobs de envio.

Entradas:

- `POST /pipeline/run` com filtros opcionais.
- Job `pipeline-product` na fila `product-pipeline`.
- Produtos persistidos e destinos ativos.

Saidas:

- Resultado agregado do pipeline.
- Copies geradas para produtos aprovados.
- Dispatches `PENDING`.
- Jobs `whatsapp-dispatch` enfileirados.

Dependencias:

- `PipelineService` em `apps/api/src/pipeline-service.ts`.
- `HunterService`, `ScoreService` e `CopyService`.
- `ProductRepository`, `GeneratedCopyRepository`, `WhatsAppDestinationRepository` e `WhatsAppDispatchRepository`.
- BullMQ e Redis via `packages/queue`.
- Worker em `apps/worker`.
- Adaptadores Prisma apenas na composicao.

Proximos passos previstos:

- Formalizar configuracao de criterios de aprovacao se o limite de score mudar.
- Adicionar painel operacional para acompanhar jobs e dispatches.
- Melhorar rastreabilidade entre produto, copy, destino e envio.
- Separar integracoes reais em providers sem alterar o contrato publico do pipeline.

## Scheduler

Responsabilidade:

- Preparar o registro e a remocao de execucoes recorrentes do pipeline.
- Enfileirar somente jobs `pipeline-product` na fila `product-pipeline`.
- Expor estado seguro do agendamento sem executar `PipelineService`.

Entradas:

- `SchedulerConfig` com `enabled`, `cronExpression`, `timezone`, `filters`
  opcionais e `jobId` estavel.
- Fila compativel com as operacoes de Job Scheduler do BullMQ.

Saidas:

- `PipelineSchedulerState` com status `disabled`, `registered` ou
  `not-registered`.
- Job recorrente com payload `{ filters }` e nome `pipeline-product` quando o
  registro for solicitado explicitamente.
- `GET /scheduler` com estado publico seguro e HTTP 200.
- HTTP 503 com `SCHEDULER_STATUS_UNAVAILABLE` quando a consulta falhar.

Dependencias:

- Contratos em `packages/queue/src/scheduler.ts`.
- `BullMqPipelineScheduler` e fila `product-pipeline` em
  `packages/queue/src/index.ts`.
- Configuracao validada por `loadConfig` em `packages/config`.
- Composicao unica em `startWorker`, usando a conexao e a fila compartilhadas.
- `SchedulerStatusService` e composicao da API em `apps/api`.

Comportamento operacional:

- `SCHEDULER_ENABLED` e `false` por padrao.
- Quando habilitado, o bootstrap registra o job recorrente com cron, timezone e
  ID estavel antes de iniciar os consumidores.
- Quando desabilitado, remove somente o agendamento conhecido e tolera sua
  inexistencia.
- Falha de registro ou remocao interrompe o bootstrap para evitar estado
  desconhecido.
- O shutdown fecha workers, fila e conexao sem remover o agendamento.
- O Scheduler nao chama `PipelineService`; apenas enfileira `pipeline-product`.
- A API consulta somente o ID estavel e nao registra, edita ou remove cron.
- A facade e criada uma vez por aplicacao e nao por request.
- Testes usam doubles em memoria, sem Redis, cron ou HTTP reais.

Proximos passos previstos:

- Adicionar observabilidade operacional do estado do agendamento em task
  dedicada, sem duplicar o processamento de `pipeline-product`.

## Analytics

Responsabilidade:

- Reunir contagens operacionais ja disponiveis nos modelos atuais.
- Retornar um `AnalyticsSnapshot` sem expor Prisma ao servico de aplicacao.

Entradas:

- `AnalyticsRepository` injetado em `AnalyticsService`.
- Produtos, copies, dispatches e destinos ja persistidos.

Saidas:

- `GET /analytics` com HTTP 200 e um `AnalyticsSnapshot`.
- Total de produtos e produtos aprovados com `score >= 70`.
- Total de copies geradas.
- Totais de dispatches `PENDING`, `SENT` e `FAILED`.
- Total de destinos ativos.

Dependencias:

- `AnalyticsService` em `apps/api/src/analytics-service.ts`.
- `AnalyticsRepository` e `AnalyticsSnapshot` em `apps/api/src/repositories.ts`.
- `PrismaAnalyticsRepository` em `apps/api/src/prisma-repositories.ts`.
- Factory de repositorios e servicos em `apps/api/src/application-services.ts`.

Restricoes atuais:

- O endpoint apenas delega a consulta ao `AnalyticsService`.
- Nao possui cache; cada consulta reflete o estado persistido naquele momento.
- Nao cria tabelas, migracoes ou novos dados.

Proximos passos previstos:

- Adicionar novas metricas somente quando o contrato do backend for ampliado em
  sprint dedicada.

## Dashboard operacional 2.0

Responsabilidade:

- Expor a interface diaria em `apps/dashboard` usando as APIs existentes e o
  proxy same-origin autenticado do servidor.
- Mostrar estado da automacao, agenda, uso de mensagens e budgets externos,
  ofertas, grupos, WhatsApps, campanhas e historico sem inventar dados.
- Manter diagnostico e detalhes de lifecycle sanitizados e somente leitura.

Entradas:

- `DASHBOARD_API_URL` e `LOCAL_API_AUTH_TOKEN` somente no processo server-side
  do proxy; nenhuma dessas credenciais chega ao navegador.
- APIs oficiais de health, analytics, scheduler, automacao, ofertas, campanhas,
  cupons, grupos, instancias, dispatches e publicacao manual protegida.
- Estado persistido de ofertas, snapshots, candidates, copies e lifecycles
  conforme os contratos atuais.

Saidas:

- Navegacao principal: Inicio, Ofertas, Grupos e WhatsApps, Automacao, Historico
  e Configuracoes.
- Areas complementares: Cupons, Campanhas, Fila e Diagnostico avancado.
- Estados de loading, vazio, erro, stale/offline e sucesso quando aplicavel.
- Pausa direta; retomada e configuracao persistida com confirmacao, CAS e
  mensagens curtas de conflito quando aplicavel.

Dependencias:

- Next.js App Router, TypeScript, Tailwind e `lucide-react` em
  `apps/dashboard`.
- Camada centralizada em `apps/dashboard/lib/api` e proxy em
  `apps/dashboard/app/api/[...path]/route.ts`.
- Testes Vitest/jsdom com fetch e funcoes da API mockados.

Regras de autoridade:

- A area **Automacao** controla pausa, retomada e regras persistidas; iniciar a
  topologia nao remove `paused=true`.
- O dashboard nao registra, remove ou assume o Scheduler e nao inicia workers.
  Processos, filas, recovery e shutdown permanecem sob autoridade do
  supervisor/worker.
- O dashboard nao acessa Prisma, Redis ou BullMQ diretamente, nao exibe URLs de
  infraestrutura e nao cria acoes sem endpoint oficial, como retry ou
  reprocessamento de dispatch.

## Commercial Pipeline Dry Run

Responsabilidade:

- Preparar uma unica oportunidade comercial a partir do catalogo persistido.
- Validar elegibilidade, calcular score pela formula existente e ordenar sem
  aleatoriedade.
- Exigir exatamente um grupo autorizado/disponivel da instancia atual.
- Gerar copy final sem cupom e registrar somente um dry-run sanitizado.

Dependencias:

- `ShopeeOfferRepository` para candidatos `MOCK`, `MANUAL` ou `OFFICIAL`
  persistidos.
- `WhatsAppGroupDirectoryRepository` para o unico grupo elegivel.
- `CommercialOfferScorePolicy`: `legacy-v1` delega exatamente ao
  `ScoreService.calculate` para `MOCK`/`MANUAL`; `official-v2` usa somente
  comissao, avaliacao, vendas e desconto oficiais persistidos.
- `CommercialCopyService`, sem persistencia em `GeneratedCopy`.
- `CommercialDeliveryHistoryRepository` para dispatches `SENT` e futuras runs
  `CONFIRMED`.
- `CommercialPipelineRunRepository` e adaptador Prisma.
- Logger seguro e relogio injetavel.

Elegibilidade e ranking:

- Oferta indisponivel, expirada, ainda nao iniciada, sem link afiliado HTTP/HTTPS
  ou com dados comerciais invalidos e rejeitada com codigo estruturado.
- O score minimo padrao e 70 para `MOCK`/`MANUAL` e 60 para `OFFICIAL`; um
  limite explicito sempre prevalece. O limite e 20, com teto 100 candidatos.
- Ordem: score, comissao, vendas, desconto, avaliacao e `providerProductId`.
- Produto ja entregue ao grupo recebe `ALREADY_SENT_TO_GROUP`; dry-run anterior
  nao e entrega.

Grupo e resultado:

- Somente `GROUP`, ativo, disponivel, da instancia atual e com fingerprint
  valido.
- Zero grupo bloqueia com `NO_AUTHORIZED_GROUP`; mais de um bloqueia com
  `MULTIPLE_AUTHORIZED_GROUPS`.
- O resultado contem ID interno, nome e fingerprint; nunca identificador
  externo.
- Copy usa nome, preco, desconto opcional, loja, CTA e link persistido. Nao usa
  cupom, comissao, score ou urgencia falsa.
- Sub_ids sao planejados pelos utilitarios existentes e nao alteram o link.

Persistencia e operacao:

- `CommercialPipelineRun` aceita enums futuros, mas esta task cria somente
  `DRY_RUN`.
- `POST /commercial-pipeline/dry-run` e as rotas de historico nao recebem fila,
  dispatch, Scheduler, Sender ou provider Evolution.
- `corepack pnpm commercial:dry-run` usa PostgreSQL local, sincroniza apenas o
  mock ficticio quando selecionado e permite `--source=official` somente sobre
  dados já persistidos, sem chamar a Shopee. Scheduler, group send e flags de
  confirmacao/envio permanecem bloqueados.
- O dashboard oferece somente executar dry-run, copiar preview e consultar
  historico.
- Runs `COMPLETED` e `BLOCKED` preservam versao da politica, limite usado e
  maior score observado; o breakdown selecionado existe somente quando um
  produto foi efetivamente escolhido.
- `corepack pnpm commercial:official:diagnose` e read-only, aceita zero
  argumentos, exige preview com automacao pausada/desabilitada e os dois
  Schedulers desligados, e grava apenas evidencia sanitizada ignorada em
  `.runtime/local-system/official-offer-diagnosis.json`.

## Commercial Pipeline Confirmed

Responsabilidade:

- Confirmar somente um `CommercialPipelineRun` `DRY_RUN/COMPLETED` existente.
- Revalidar o mesmo produto, copy e grupo, sem executar ranking novamente.
- Atualizar o proprio run para `CONFIRMED`, criar um dispatch e um job e
  finalizar o historico a partir do worker de dispatch existente.

Idempotencia e seguranca:

- Copy, dispatch e job usam IDs deterministicos derivados do `dryRunId`.
- `GeneratedCopy`, `WhatsAppDispatch`, atualizacao do run e
  `CommercialDispatchOutbox` `PENDING` sao persistidos na mesma transacao.
- O publicador independente verifica o job deterministico: job existente e
  somente reconhecido, job ausente e criado uma vez. Incerteza vira
  `AMBIGUOUS` e exige investigacao manual, sem retry automatico.
- O job `whatsapp-dispatch` usa `attempts: 1`, sem backoff e sem remocao.
- Timeout, falha ou resultado ambiguo registram `investigationRequired=true` e
  nunca autorizam retry ou limpeza de historico.
- Imediatamente antes do dispatch, produto/link, grupo unico, instancia, safe
  mode, master switch, Scheduler desligado e limite 1 sao revalidados.
- A copy enviada e o snapshot aprovado. Cupons, score, comissao, IDs tecnicos e
  urgencia falsa continuam ausentes.

Operacao:

- `POST /commercial-pipeline/runs/:id/confirm` aceita somente
  `{ "confirmation": "CONFIRMAR_ENVIO_COMERCIAL" }`.
- `corepack pnpm commercial:confirm -- --run-id=<id>
--confirm-one-real-commercial-message` e o unico CLI real, bloqueado em CI e
  composto apenas com fila/worker de dispatch.
- O dashboard exige a mesma frase em modal, remove a acao depois de qualquer
  tentativa e exibe apenas fingerprint, status, tentativas e existencia de ID
  externo.
- `commercial:outbox:status` consulta evidencia sanitizada. O reconcile exige
  somente `--outbox-id` e `--confirm-safe-publication`, modo preview, ambos os
  Schedulers desligados e ausencia de worker de dispatch.
- `GET /commercial-automation/outbox` e
  `GET /commercial-automation/outbox/:id` sao somente leitura; nao existe rota
  HTTP de publicacao.

## Commercial Automation Guardrails

Responsabilidade:

- Avaliar de forma deterministica se uma futura automacao comercial estaria
  autorizada, sem executar pipeline, Scheduler, fila, dispatch ou provider.
- Reunir master switch, pausa persistida, janela no timezone configurado,
  limites diarios, intervalo minimo, grupo unico e bloqueios ambiguos.
- Expor `evaluateAutomationReadiness()` como contrato estavel para integracao
  futura.

Persistencia e historico:

- `CommercialAutomationSettings` e um singleton criado pausado e armazena
  `paused`, `pausedAt`, `resumedAt` e `updatedAt`.
- `CommercialAutomationSettingsRepository` e
  `CommercialAutomationHistoryRepository` isolam o servico do Prisma.
- Contagens usam somente `WhatsAppDispatch` `SENT`, com destino `GROUP` e
  `sentAt` dentro do dia no timezone configurado. Dry-runs e falhas nao criam
  contadores paralelos.
- `CommercialPipelineRun` com `finalStatus=AMBIGUOUS` ou
  `investigationRequired=true` bloqueia novas decisoes ate investigacao manual.

Operacao:

- `COMMERCIAL_AUTOMATION_ENABLED=false` e pausa persistida ativa sao os dois
  defaults de seguranca.
- `GET /commercial-automation/status` retorna somente decisao, motivos,
  horarios e contagens sanitizadas.
- `PATCH /commercial-automation/settings` pausa com `{ "paused": true }` e
  retoma somente com a confirmacao exata `RETOMAR_AUTOMACAO_COMERCIAL` e a
  versao esperada; rotas de agenda e configuracao administrativa usam suas
  revisoes/CAS correspondentes.
- A API usa `HOST=127.0.0.1` por padrao. Alterar o bind exige configuracao
  explicita do ambiente.
- O dashboard apresenta o controle na area Automacao e deixa explicito que
  pausar/retomar nao envia mensagens nem assume o Scheduler.

## Commercial Automation Scheduler

Responsabilidade:

- Agendar e executar um tick comercial isolado, sempre passando primeiro por
  `CommercialAutomationPolicyService`.
- Sincronizar o catalogo uma vez, executar um dry-run comercial uma vez e
  terminar em preview ou delegar a confirmacao ao servico existente.
- Persistir cada tentativa em `CommercialAutomationExecution`, com identidade
  BullMQ, estado terminal e motivo sanitizado.

Isolamento e idempotencia:

- Usa somente a fila `commercial-automation`, o job
  `commercial-automation-tick` e o Scheduler ID
  `scheduled-commercial-automation`.
- A fila legada `product-pipeline`, o job `pipeline-product` e o Scheduler ID
  `scheduled-pipeline-product` nao sao registrados, removidos nem consumidos
  por este bootstrap.
- O worker comercial tem concorrencia 1. Jobs possuem `attempts: 1`, sem
  backoff e sem remocao automatica; jobs desconhecidos sao ignorados.
- `bullMqJobId` torna a execucao idempotente e `activeKey` impede ticks
  simultaneos. Run confirmado iniciado, final pendente ou dispatch comercial
  `PENDING/PROCESSING` tambem bloqueia com
  `COMMERCIAL_EXECUTION_IN_PROGRESS`.
- Cada `STARTED` novo recebe owner aleatorio, heartbeat e lease atomicos. Somente
  o mesmo owner com lease valida pode renovar ou finalizar; owner antigo nunca
  reativa uma lease vencida.
- `STARTED` sem ownership/lease ou com lease vencida e stale e bloqueia a
  politica com `STALE_COMMERCIAL_EXECUTION_EXISTS`, separadamente de uma
  execucao ativa.

Configuracao e seguranca:

- `COMMERCIAL_SCHEDULER_ENABLED=false`, cron `0 9 * * *`, timezone
  `America/Sao_Paulo` e modo `preview` sao os defaults.
- A lease usa 120 segundos e heartbeat de 30 segundos por padrao; ambos sao
  inteiros positivos e o heartbeat deve ser menor que metade da lease.
- O modo `send` exige provider Shopee `official`, Evolution, safe mode e o
  master switch de grupos, mantendo o Scheduler legado desligado. Providers
  `mock` e `manual` sao bloqueados para envio.
- O bootstrap apenas registra ou remove o Scheduler comercial e inicia seu
  consumer; nao executa um tick na inicializacao.
- O CLI `corepack pnpm commercial:automation:preview` forca preview, exige os
  dois Schedulers desligados e nao cria dispatch, job de WhatsApp ou mensagem.
  Nao existe CLI de envio para esta automacao.

Observabilidade:

- `GET /commercial-automation/scheduler` expoe somente estado, agenda, modo e
  proxima execucao sanitizados.
- `GET /commercial-automation/executions` e
  `GET /commercial-automation/executions/:id` expoem `stale`, `heartbeatAt` e
  `leaseExpiresAt`, mas nunca `ownerId`.
- Nao existe endpoint de uso diario para disparar tick ou assumir o Scheduler.
  O dashboard pode editar regras persistidas de automacao com CAS, mas registro,
  consumidores e shutdown continuam sob autoridade do supervisor/worker.
- `commercial:execution:status` e somente leitura. A recuperacao aceita somente
  `commercial:execution:recover -- --execution-id=<id>
--confirm-stale-recovery`, exige preview, automacao desabilitada/pausada e os
  dois Schedulers desligados; nao inicia worker/provider nem publica outbox.
- Recuperacao stale usa somente evidencia persistida e compare-and-set:
  ausencia segura de efeitos termina `FAILED`, job publicado comprovado termina
  `QUEUED`, outbox `PENDING` exige o reconcile existente e qualquer incerteza
  termina `AMBIGUOUS`, sem enqueue, takeover ou retry automatico.

## Supervisor local

Responsabilidade:

- Operar a topologia local atual por `system:start`, `system:status`,
  `system:logs` e `system:stop`.
- Iniciar explicitamente API, dashboard e worker comercial; adicionar o worker
  isolado de `whatsapp-dispatch` somente em modo `send`.
- Manter estado e logs locais sanitizados em `.runtime/local-system/`.
- Validar estabilidade real em preview somente pelo comando confirmado
  `system:stability:preview`, com sistema inicialmente parado, estados
  comerciais seguros e restauração obrigatória da pausa e dos Schedulers.

Dependencias:

- `apps/system-supervisor`, implementado com APIs nativas de Node.js e
  adaptadores injetaveis.
- Compose principal e compose isolado em `infra/evolution`.
- Endpoints existentes de health, Scheduler e automacao comercial.
- Bootstrap isolado `apps/worker/src/whatsapp-dispatch-runtime.ts`.

Comportamento operacional:

- Nunca executar o script raiz `dev` nem iniciar o worker do pipeline legado.
- Nunca disparar tick, dry-run, confirmacao, dispatch, E2E ou mensagem no
  bootstrap.
- Carregar `.env` ignorado com variaveis do processo prevalecendo, sem
  persistir ou imprimir segredos.
- Validar identidade e horario de cada PID antes da parada; ocupantes externos
  de porta e PIDs divergentes nunca sao encerrados.
- Serializar `system:start` e `system:stop` com lock JSON estrito, owner token
  aleatorio, marcador conhecido e horario real do processo. PID isolado nunca
  comprova ownership; lock invalido e preservado, e PID reutilizado e stale sem
  encerramento do ocupante.
- Recuperar lock stale somente depois de releitura do mesmo owner token e
  reivindicacao atomica por hard link. A liberacao compara token, PID e inicio
  do processo, e uma liberacao atrasada nunca remove o lock sucessor.
- Retornar sucesso do start somente apos snapshot final `running`; estado
  parcial durante a inicializacao reverte os filhos criados na tentativa.
- Usar `prisma migrate deploy`, nunca `migrate dev`, na operacao local.
- Parar composes sem remover volumes, dados ou agendamentos.
- O supervisor apenas consulta Schedulers; registro ou remocao continuam sob
  responsabilidade dos bootstraps dos respectivos workers.
- `system:status` classifica o lock como `unlocked`, `active`, `stale`,
  `invalid` ou `unavailable` sem corrigi-lo e nunca expoe o owner token.
- Reinício parcial reutiliza o Prisma Client já gerado enquanto outros filhos
  gerenciados permanecem ativos; a geração continua nas inicializações frias.
- Portas da API e do dashboard podem pertencer a descendentes do launcher; o
  supervisor aceita somente descendência comprovada e continua bloqueando e
  preservando qualquer ocupante externo.
- A validação de estabilidade usa apenas o Scheduler comercial em preview e o
  provider Shopee mock. Ela exige exatamente um grupo já autorizado e usa sua
  instância persistida somente nos processos filhos, sem alterar o grupo ou o
  `.env`. Indisponibilidades temporárias usam somente
  `docker compose stop/start`; nunca removem volumes, iniciam o worker de
  dispatch ou recuperam estados stale/ambíguos.

## Nichos e campanhas por grupo lógico

- `CommercialNiche` guarda critérios determinísticos para ofertas `OFFICIAL`:
  categorias, keywords normalizadas, faixas comerciais e score mínimo.
- O matching usa tokens e frases normalizados, com include `ANY` e exclusão
  prioritária; não usa regex, substring arbitrária, IA ou chamadas externas.
- `CommercialGroupCampaign` pertence ao fingerprint lógico derivado somente do
  JID canônico do grupo. O destino âncora é uma referência interna atual, não a
  identidade da campanha nem um vínculo permanente com uma instância Evolution.
- A campanha nasce inativa. Ativação exige `ATIVAR_CAMPANHA`, nicho ativo e ao
  menos um destino correspondente ativo, disponível e associado a uma instância.
- A quantidade teórica de slots é
  `floor((fimEmMinutos - inicioEmMinutos) / cadenceMinutes)`; o limite diário
  não pode excedê-la.
- Esta fundação não cria copy por IA, sender assignments, dispatch, outbox, job
  ou mensagem.

## Mineração de promoções por campanha

- `CommercialPromotionMiningService` avalia somente o catálogo `OFFICIAL`
  persistido, pelo matcher do nicho e pelo score `official-v2`; não consulta a
  Shopee nem compõe providers, BullMQ, Redis, Scheduler, worker ou WhatsApp.
- Os sinais determinísticos são `PRICE_DROP`, `DISCOUNT_INCREASE`,
  `NEWLY_OBSERVED` e `CURRENT_DISCOUNT`. Comparações monetárias usam `Decimal`;
  snapshot, revision e fingerprint devem corresponder ao produto atual.
- A ordenação é estável: queda de preço, percentual da queda, score oficial,
  desconto, comissão, vendas e ID interno. A avaliação usa cursor, no máximo
  200 itens por página e 2.000 itens por execução; preview truncado é parcial e
  mineração truncada não persiste.
- `CommercialPromotionCandidate` guarda campanha, produto, snapshot, sinais,
  score, posição e estado `QUEUED`, `COPY_READY`, `RESERVED`, `DISPATCHED`,
  `EXPIRED` ou `BLOCKED`. A unique campanha + produto torna a materialização
  idempotente.
- `COPY_READY` e `RESERVED` são protegidos e contam na capacidade ativa.
  `DISPATCHED` fica fora dessa capacidade, bloqueia enquanto `dedupeUntil` está
  ativo e pode voltar a `QUEUED` depois, se não houver envio `SENT` recente ao
  mesmo fingerprint lógico. Conflito concorrente é sanitizado e nunca recebe
  retry.
- `POST /commercial/campaigns/:id/mining-preview` é somente leitura;
  `POST /commercial/campaigns/:id/mine` exige
  `{ "confirm": "MINERAR_PROMOCOES" }`; `GET
/commercial/campaigns/:id/queue` é paginado e sanitizado. Nenhuma rota publica
  ou envia candidatos.
- As CLIs `commercial:campaign:preview` e `commercial:campaign:mine` usam banco
  local; a segunda exige `--confirm-local-promotion-mining`, modo preview,
  automação desabilitada e pausada, ambos os Schedulers e group send desligados,
  fora de CI e zero worker de dispatch.

## Geração validada de copies promocionais por IA

- `CommercialPromotionCopyGenerationService` depende apenas de interfaces. O
  provider OpenAI usa Responses API com Structured Output estrito,
  `store=false`, sem streaming, background, tools ou retry automático.
- O prompt `commercial-promotion-copy-v2` e a validação
  `commercial-promotion-copy-validation-v2` recebem somente nome do produto,
  loja, nicho, sinais, score, desconto, avaliação, vendas, queda opcional e
  limites. Nunca recebem links, IDs externos, fingerprints, JID, credenciais ou
  payload externo.
- Strings do catálogo são dados não confiáveis: controles são removidos antes
  do request, Unicode é normalizado em NFKC, espaços e tamanhos são limitados e
  comandos embutidos nunca alteram as instruções.
- A IA produz apenas `headline`, `body`, `cta` e até três hashtags. O validador
  rejeita números, moeda, percentual, URLs, contatos, markdown, alegações não
  comprovadas, controles, repetição, hashtags inválidas e excesso de emojis.
  Produto, loja, preço em BRL, desconto, no máximo um sinal promocional e o
  `affiliateLink` exato são montados deterministicamente depois da validação.
- `GeneratedCopy.source=AI` guarda somente metadados versionados, usage e o
  vínculo `RESTRICT` ao snapshot. Registros e fluxos legados continuam com
  `LEGACY_TEMPLATE`; `CommercialCopyService`, Sender e seus quatro campos
  públicos não mudam.
- O candidato só passa de `QUEUED` para `COPY_READY` com `generatedCopyId` AI
  coerente com o mesmo produto e snapshot. A chamada externa ocorre fora da
  transação; a revalidação, criação da copy, conclusão da tentativa e transição
  do candidato são atômicas em transação serializável.
- Fingerprint SHA-256 canônico governa cache e claim único. `STARTED` bloqueia
  concorrência, `SUCCEEDED` reutiliza a copy e `FAILED` ou `AMBIGUOUS` bloqueiam
  repetição do mesmo input; nenhuma tentativa é apagada e não há retry.
- Preflight e preview são somente leitura. Nenhuma rota ou CLI desta camada
  cria pipeline run, automation execution, dispatch, outbox, job ou mensagem.
