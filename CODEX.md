# CODEX.md

## Visao geral do projeto

`shopee-auto-affiliate-ai` e um monorepo com pnpm workspaces e Turborepo para automatizar um pipeline afiliado modular da Shopee. O projeto reune API, worker, dashboard e pacotes compartilhados para buscar produtos, calcular score, gerar copies promocionais e preparar envios por WhatsApp usando providers mockados no estado atual.

## Objetivo do sistema

O sistema tem como objetivo apoiar um fluxo de afiliados da Shopee:

1. Encontrar produtos por filtros comerciais.
2. Persistir ou atualizar leads de produtos.
3. Calcular score matematico para priorizacao.
4. Gerar copy promocional por templates locais.
5. Criar dispatches para destinos ativos de WhatsApp.
6. Processar os envios via fila usando o provider WhatsApp selecionado no worker.

O estado atual nao executa scraping real nem usa OpenAI real. No modo padrao `mock`, nao envia mensagens reais por WhatsApp.

## Arquitetura atual

- Monorepo: gerenciado por `pnpm-workspace.yaml` e `turbo.json`.
- API: Fastify em `apps/api`, expondo endpoints de health, Analytics, Hunter, Score, Copy, Pipeline e WhatsApp.
- Camada de aplicacao: servicos em `apps/api/src/*-service.ts`, sem dependencia direta do Prisma Client.
- Contratos de repositorio: interfaces pequenas em `apps/api/src/repositories.ts`.
- Adaptadores Prisma: implementacoes concretas em `apps/api/src/prisma-repositories.ts`.
- Composicao: factory em `apps/api/src/application-services.ts`, reutilizada pela API e pelo worker.
- Worker: BullMQ em `apps/worker`, consumindo filas de pipeline e dispatch.
- Dashboard: Next.js App Router em `apps/dashboard`.
- Banco: Prisma Client e schema PostgreSQL em `packages/database`.
- Filas: BullMQ/Redis em `packages/queue`.
- Scheduler: contratos e adaptador BullMQ em `packages/queue`, compostos uma
  unica vez no bootstrap do worker e desativados por padrao. A API expoe apenas
  a consulta segura `GET /scheduler`.
- Agentes: contratos e implementacoes iniciais em `packages/agents`.
- Providers: contratos e mocks para Shopee, OpenAI, Evolution API e WhatsApp em `packages/providers`.
- Shopee Affiliate: contrato de ofertas independente de HTTP/Prisma, providers
  mock/manual/official e metadados de Sub_ids em `packages/providers`; sync,
  catálogo, importação, cupons e preview sem envio em `apps/api`.
- Evolution API: provider HTTP v2, `EvolutionSendGuard` e factory segura em
  `packages/providers`, conectados uma unica vez ao bootstrap do worker.
- Diretorio de grupos: provider read-only 2.3.7 e fingerprints criptograficos
  em `packages/providers`, servico/repositorio/API em `apps/api` e UI na pagina
  WhatsApp do dashboard.
- Teste Evolution isolado: CLI em
  `apps/worker/src/evolution-single-message-test.ts`, separado do bootstrap,
  filas, banco, Scheduler e pipeline.
- Analytics: contrato, adaptador Prisma, servico de snapshot e endpoint `GET /analytics` em `apps/api`, consumido pela visao geral do dashboard.
- Configuracao: validacao de variaveis de ambiente com Zod em `packages/config`.
- Shared: tipos, erros e utilitarios comuns em `packages/shared`.
- Runtime ESM: `tsconfig.runtime.json` direciona todos os entrypoints `tsx`
  para os fontes dos pacotes, enquanto build/typecheck usam os contratos de
  declaracao e JavaScript compilado em `dist`.

## Baseline do histórico Prisma

A migration `0_legacy_baseline` representa o schema imediatamente anterior a
`20260724000000_whatsapp_dispatch`: somente as tabelas históricas
`ProductLead` e `GeneratedCopy`, seus índices, chaves e relacionamento. O SQL
foi gerado com a versão Prisma fixada e as migrations posteriores não são
alteradas.

Instalações novas executam `db:migrations:verify-clean` e `db:deploy`. Um banco
existente criado antes da baseline deve consultar `db:baseline:status`, adotar
uma única vez com `db:baseline:adopt -- --confirm-existing-database` e então
usar `db:deploy`. A adoção chama apenas `prisma migrate resolve --applied` para
a baseline, não executa seu SQL e comprova que schema e contagens comerciais
permaneceram iguais.

## Dashboard operacional 2.0

O dashboard atual e a interface de operacao diaria em `apps/dashboard`. O
navegador usa a camada centralizada de API e o proxy same-origin autenticado do
servidor; nao acessa Prisma, Redis, BullMQ ou segredos diretamente.

A navegacao principal e **Inicio**, **Ofertas**, **Grupos e WhatsApps**,
**Automacao**, **Historico** e **Configuracoes**. As telas complementares de
**Cupons**, **Campanhas**, **Fila** e **Diagnostico avancado** cobrem catalogo,
agenda, ranking persistido e investigacao tecnica.

Responsabilidades atuais:

- **Inicio** resume API, automacao, atividade, ultimo/proximo envio e a jornada
  do dispatch quando houver dados persistidos.
- **Ofertas** consulta `GET /shopee/offers` com filtros e paginacao. Ações de
  sincronização, importação, detalhe e preview só devem ser consideradas
  disponíveis quando estiverem autorizadas pelo proxy same-origin; esta
  documentação não as promete como fluxo operacional atual.
- **Grupos e WhatsApps** reutiliza as APIs protegidas de instancias, grupos,
  autorizacao e assignments, exibindo health sanitizado e blockers.
- **Automacao** pausa diretamente, exige confirmacao/CAS para retomada e edita horario, intervalo,
  stagger, limites de mensagens e budgets diarios externos.
- **Historico**, **Configuracoes** e **Diagnostico avancado** permanecem
  sanitizados; diagnostico nao publica, recupera ou altera lifecycle.

Iniciar a topologia nao liga a automacao. A pausa persistida e controlada na
area Automacao, enquanto processos, filas, registro do Scheduler e shutdown
continuam sob autoridade do supervisor.

## Analytics

O modulo de Analytics prepara agregacoes sobre os dados ja persistidos, sem criar
tabelas ou alterar o comportamento operacional. `AnalyticsRepository` define as
contagens e `PrismaAnalyticsRepository` usa somente `count` nos modelos atuais.
`AnalyticsService` reune os resultados em `AnalyticsSnapshot`.

Metricas disponiveis na arquitetura:

- total de produtos;
- total de produtos aprovados com `score >= 70`;
- total de copies geradas;
- total de dispatches pendentes, enviados e com falha;
- total de destinos ativos.

O endpoint `GET /analytics` retorna o snapshot atual diretamente do servico, sem
cache e sem calculos na rota. As metricas refletem apenas os dados persistidos no
momento da consulta. A visao geral consome esse endpoint pela camada centralizada
de API e exibe as sete metricas do contrato. Loading, erro e retry sao isolados
do restante da pagina. Apos executar o pipeline, o usuario pode fazer uma unica
nova consulta pelo botao `Atualizar metricas`, sem polling permanente ou estado
global entre paginas.

## Scheduler

O modulo de Scheduler oferece o agendamento recorrente do pipeline sem executar
`PipelineService` diretamente. `SchedulerConfig` e `PipelineScheduler` formam o
contrato independente de BullMQ. `BullMqPipelineScheduler` usa a API de Job
Schedulers da fila `product-pipeline` para registrar apenas jobs
`pipeline-product` com ID estavel, consultar o estado e remover o agendamento.

Configuracao opcional:

- `SCHEDULER_ENABLED=false` por padrao;
- `SCHEDULER_CRON`, exigido e validado somente quando habilitado;
- `SCHEDULER_TIMEZONE`, exigido como timezone IANA somente quando habilitado.

O bootstrap do worker cria uma unica instancia do Scheduler com a conexao e a
fila `product-pipeline` compartilhadas. Quando habilitado, registra o job com o
cron e timezone validados; quando desabilitado, remove apenas o ID estavel
conhecido. Os consumidores so iniciam depois que essa operacao termina com
sucesso, e qualquer falha interrompe o bootstrap com log estruturado seguro.

O encerramento fecha workers, fila e conexao sem remover o agendamento. O fluxo
manual por `POST /pipeline/run` permanece disponivel, e tanto o job manual quanto
o recorrente reutilizam o mesmo processor `pipeline-product`.

A API compoe uma instancia de `SchedulerStatusService` por aplicacao sobre a
fila `product-pipeline` compartilhada. `GET /scheduler` retorna configuracao,
estado, ID, fila, nome do job, cron, timezone e proxima execucao informada pelo
BullMQ. A rota depende apenas da facade, nao cria filas por request e nao chama
`register`, `remove` ou `PipelineService`.

Se o estado nao puder ser consultado, a API retorna HTTP 503 com
`SCHEDULER_STATUS_UNAVAILABLE` e mensagem publica segura. O fechamento da API
encerra a fila e a conexao criadas pela aplicacao.

O cliente do dashboard consulta `GET /scheduler` somente pela camada
centralizada de API para o agendamento legado. A agenda comercial do uso diário
usa `/commercial-automation/scheduler` nas áreas Início, Automação e Diagnóstico
avançado. As consultas possuem loading, erro e retry isolados; HTTP 503 não é
convertido em estado desativado. O dashboard não registra, remove ou assume o
Scheduler: cron, enabled e shutdown continuam sob autoridade do worker e do
supervisor.

Regras de seguranca do dashboard:

- Nao colocar `EVOLUTION_API_KEY` ou qualquer segredo em `NEXT_PUBLIC_*`.
- Credenciais da Evolution API ficam somente no `.env` local do worker.
- O provider `mock` continua sendo o modo seguro por padrao.
- O dashboard nao armazena credenciais no navegador.

Fluxo operacional atual:

1. `POST /pipeline/run` ou o Scheduler enfileira um job `pipeline-product`.
2. O worker consome `product-pipeline`.
3. `PipelineService` executa Hunter, Score e Copy.
4. Produtos com `score >= 70` sao considerados aprovados.
5. Para cada copy e destino ativo, o pipeline cria `WhatsAppDispatch` com status `PENDING`.
6. O pipeline enfileira jobs `whatsapp-dispatch`.
7. O bootstrap do worker cria uma unica instancia do provider configurado e a injeta no `SenderService`.
8. `WHATSAPP_PROVIDER=mock` permanece como padrao; `evolution` exige configuracao completa e explicita.
9. Em Evolution, o safe mode ativo por padrao valida uma allowlist normalizada
   e reserva o limite por processo imediatamente antes do request HTTP.
10. O Sender adquire atomicamente apenas `PENDING`. Depois do request, timeout,
    erro HTTP/rede ou falha ao persistir `SENT` conservam `PROCESSING`; retry e
    redelivery falham fechados sem nova chamada externa.

Seguranca do provider Evolution:

- A Evolution API 2.3.7 local recebe texto com o payload plano
  `{ "number": "<destination>", "text": "<message>" }`. O provider nao tenta
  automaticamente `textMessage` ou outro formato para evitar duplicidade.
- `EVOLUTION_SAFE_MODE=true` e o padrao.
- `EVOLUTION_ALLOWED_DESTINATIONS` e uma lista separada por virgulas; vazia
  bloqueia todos os envios reais.
- `EVOLUTION_MAX_MESSAGES_PER_BOOT` aceita apenas inteiro positivo e vale 1 por
  padrao.
- A comparacao remove apenas formatacao comum, exige somente digitos e e exata;
  correspondencias parciais nao sao aceitas.
- Requests iniciados contam mesmo em timeout ou erro HTTP. Bloqueios por
  destino ou limite acontecem antes do HTTP e nao incrementam o contador.
- Safe mode desativado exige valor `false` explicito. Credenciais nao alteram
  esse valor automaticamente.
- O mock nao cria guard e nao e afetado por essas variaveis.
- Logs podem registrar estado, limite, quantidade permitida, contador, codigo
  e destino mascarado, nunca chaves, allowlist ou payload completo.

Teste isolado de uma mensagem Evolution:

1. `corepack pnpm evolution:test-message` executa dry-run por padrao no Windows
   sem exigir `pnpm` global.
2. O comando rejeita CI, flags parecidas e qualquer argumento de destino ou
   mensagem.
3. Exige provider Evolution, safe mode ativo, Scheduler desativado, exatamente
   um destino permitido e limite igual a 1.
4. Reutiliza `createWhatsAppProvider`, `EvolutionSendGuard`, normalizacao,
   mascaramento e tratamento HTTP existentes.
5. O dry-run cria provider e guard, exibe resumo seguro e encerra sem chamar
   `sendMessage`.
6. O caminho de envio exige a flag exata `--confirm-one-real-message`, direta
   ou apos um unico separador `--`, sem prompt ou timeout de confirmacao.
7. A mensagem e fixa e nao usa produto, copy, link, hashtag, dispatch, pipeline
   ou banco.
8. O modulo nao importa bootstrap do worker, BullMQ, Redis, Prisma, filas ou
   servicos da aplicacao.
9. Timeout, erro de rede, HTTP 5xx ou resultado ambiguo proibem retry manual ou
   automatico, pois o request pode ter sido aceito externamente.

Credenciais ficam apenas no `.env` local nao versionado. Na Task 13.4, a stack e
a instancia local foram confirmadas como saudaveis/conectadas, mas o dry-run foi
bloqueado porque a configuracao ignorada ainda selecionava `mock` e mantinha a
allowlist vazia. Nenhuma mensagem real foi enviada e nenhum segredo foi
versionado.

Teste E2E controlado de dispatch:

1. `corepack pnpm whatsapp:e2e-test` carrega o `.env` raiz com precedencia para
   variaveis de processo, valida Evolution 2.3.7, instancia open, banco e Redis
   principais e termina em dry-run sem escrita, job, worker ou envio.
2. O caminho real aceita somente a flag exata
   `--confirm-one-real-dispatch`, permanece bloqueado em CI e exige provider
   Evolution, URL/instancia locais esperadas, safe mode ativo, allowlist com um
   destino, limite 1 e Scheduler desativado.
3. Produto, copy, destino, dispatch e job possuem identidade deterministica. O
   destino tecnico e inativo. Qualquer dispatch/job anterior ou trabalho
   concorrente bloqueia uma nova execucao sem apagar historico.
4. O job `whatsapp-dispatch` usa `attempts: 1`, nao possui backoff e nao e
   removido automaticamente. Jobs normais preservam tres tentativas, mas
   apenas a primeira aquisicao atomica de `PENDING` pode chamar o provider.
5. O worker E2E instancia somente o consumer de dispatch e cria uma unica
   factory de provider/guard. `SenderService` recebe um message builder fixo
   para entregar exatamente a frase controlada, sem alterar mensagens normais.
6. O resultado e relido do banco e por `GET /whatsapp/dispatches/:id` usando
   `app.inject`; o detalhe publico mascara o destino.
7. Timeout, erro de rede, HTTP 5xx, `FAILED`, `PENDING` inesperado ou resultado
   ambiguo exigem investigacao manual. O comando nunca reenfileira ou repete.

Na preparacao da Task 13.5, Evolution e a instancia foram validadas como
saudaveis/open, e o banco/Redis principais ficaram disponiveis. O `.env` raiz
continuou em `mock`, com instancia de exemplo e allowlist vazia, bloqueando o
dry-run antes de qualquer escrita. Nenhuma mensagem real foi enviada.

## Diretorio WhatsApp de grupos

O contrato externo fixado para Evolution API 2.3.7 e somente leitura:
`GET /group/fetchAllGroups/:instanceName?getParticipants=false`, header
`apikey`, sem body. A query obrigatoria impede o retorno de participantes. A
implementacao oficial monta `id`, `subject`, `size` e outros metadados, mas
`EvolutionApiGroupDirectoryProvider` conserva somente identificador interno,
nome e contagem opcional. Resposta bruta, participantes, descricao, convite,
owner, foto, tokens e sessao nunca atravessam o provider.

`normalizeWhatsAppGroupId` remove apenas espacos externos, exige o formato de
grupo `@g.us` confirmado na tag e nunca chama `normalizeEvolutionDestination`.
`fingerprintWhatsAppGroupId` usa SHA-256 truncado com prefixo `grp_`; APIs,
dashboard e logs nao mostram o identificador externo.

`GroupDirectoryService` sincroniza por instancia. Novos registros do tipo
`GROUP` nascem disponiveis e inativos. Metadados seguros sao atualizados sem
alterar uma autorizacao existente; ausencias sao preservadas, marcadas
indisponiveis e desativadas. O relatorio contem apenas `discovered`, `created`,
`updated`, `unavailable` e `active`.

Rotas: `POST /whatsapp/groups/sync`, `GET /whatsapp/groups`,
`GET /whatsapp/groups/:id` e `PATCH /whatsapp/groups/:id`. O PATCH aceita apenas
`active`; ativacao exige `AUTORIZAR_GRUPO`, desativacao e direta e grupos
indisponiveis nao podem ser ativados. Nao existe rota de envio.

O pipeline foi isolado por tipo no adaptador: `listActive()` retorna somente
`INDIVIDUAL`, mesmo que varios grupos estejam ativos. O Scheduler nao ganhou
nenhum job ou fanout. Antes do HTTP, `WhatsAppGroupSendPolicy` exige grupo da
instancia atual, disponivel, ativo, identidade exata, safe mode e master switch.
O provider aplica ainda `EvolutionGroupSendGuard`, com limite por processo. As
protecoes de telefone e a allowlist anterior permanecem separadas.

Configuracao segura:

```env
WHATSAPP_GROUP_SEND_ENABLED=false
WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN=1
```

`corepack pnpm whatsapp:group-test` e dry-run sem escrita, fila, worker ou
envio. O unico caminho futuro confirmado aceita somente
`--confirm-one-real-group-message`, e bloqueado em CI e exige um unico grupo
ativo/disponivel, master switch, safe mode, limite 1 e Scheduler desligado. Ele
usa texto e IDs fixos, uma tentativa, sem backoff/retry/remocao e bloqueia
qualquer repeticao depois de dispatch/job anterior. Esse caminho foi validado
apenas por mocks e nao deve ser executado nesta task.

A nova migracao `20260724190000_whatsapp_group_directory` foi aplicada ao banco
existente. Um banco limpo nao pode ser validado enquanto a migracao historica
`20260724000000_whatsapp_dispatch` depender de tabelas preexistentes que ela nao
cria. O primeiro erro reproduzido e Prisma `P3018`, PostgreSQL `42P01`,
`relation "ProductLead" does not exist`; a migracao antiga foi preservada sem
alteracao.

## Infraestrutura local da Evolution API

`infra/evolution` contem um compose independente do compose principal. Ele fixa
`evoapicloud/evolution-api:v2.3.7`, `postgres:16.4-alpine3.20` e
`redis:7.2.5-alpine3.20`, usa uma rede exclusiva, volumes persistentes com
prefixo proprio e publica somente a API em `127.0.0.1:8080` por padrao.
PostgreSQL e Redis ficam acessiveis apenas na rede Docker da stack.

`corepack pnpm evolution:init` cria uma unica vez `infra/evolution/.env.local`, gera API
key e senha PostgreSQL fortes e nao mostra seus valores. O arquivo local esta
explicitamente ignorado. `evolution:config`, `evolution:pull`, `evolution:up`,
`evolution:down`, `evolution:status`, `evolution:logs` e `evolution:restart`
sempre apontam para esse compose e carregam esse arquivo local.

A Evolution API 2.3.7 nao oferece `/health` ou `/server/ok`; sua rota publica
`GET /` e o status suportado e retorna HTTP 200, mensagem, versao e clientName.
O healthcheck da API usa essa rota. A versao foi escolhida por ser a ultima
release estavel 2.3.x, incorporar a correcao da migracao Kafka da 2.3.5 e nao
ter a ativacao remota obrigatoria introduzida na 2.4.0. A licenca da tag e
Apache 2.0 com condicoes adicionais de marca/copyright e aviso de uso; o
descumprimento pode exigir licenca comercial.

A stack nao automatiza criacao/conexao de instancia, QR Code ou mensagens. Ela
tambem nao inicia worker, pipeline nem Scheduler. Integracoes externas,
telemetria opcional e persistencia de mensagens/contatos/chats ficam
desativadas. O estado seguro desta task nao possui instancia criada, conta
conectada ou mensagem enviada.

O fluxo manual continua disponivel mesmo quando o Scheduler esta habilitado.

Regra de dependencia:

- Servicos de aplicacao recebem contratos por injecao de dependencia.
- Servicos de aplicacao nao importam Prisma Client nem tipos internos do Prisma.
- Operacoes `findUnique`, `findMany`, `create`, `update`, `select`, `include` e tratamento de codigos Prisma ficam nos adaptadores Prisma.
- API e worker devem montar servicos por `createApplicationServices` ou factories equivalentes, sem espalhar novas instanciacoes manuais.
- O worker deve selecionar o provider em `startWorker`, reutilizando a mesma instancia nos jobs de pipeline e dispatch.
- `ShopeeOfferSyncService` depende somente de `ShopeeAffiliateOfferProvider` e
  `ShopeeOfferRepository`; não recebe Copy, dispatch, fila, Scheduler ou sender.

## Shopee Affiliate sem credenciais

O padrão é `SHOPEE_AFFILIATE_PROVIDER=mock`. O provider manual aceita somente
registros locais validados e preserva o link afiliado fornecido. O provider
official é apenas uma boundary com signer/transport injetáveis e nunca faz HTTP
nesta task. Configuração incompleta retorna `SHOPEE_API_NOT_CONFIGURED`.

A chave lógica de `ProductLead` é `source + providerProductId`. Sincronizações
atualizam o mesmo registro e preservam copies e dispatches. Dinheiro novo usa
string decimal no domínio e `Decimal` no Prisma. Ofertas expiradas são ignoradas
na sincronização e inelegíveis para score.

Ofertas `OFFICIAL` são persistidas por um boundary transacional que mantém o
estado atual no `ProductLead` e cria `CommercialOfferSnapshot` apenas quando o
fingerprint de preço, desconto, comissão, vigência ou indisponibilidade muda.
Revision mede transições comerciais, não leituras: A → B → A gera revisions 1,
2 e 3, enquanto A → A mantém uma única revision. Rating e vendas ficam como
observações do snapshot criado, mas sozinhos não alteram o fingerprint.
`capturedAt` preserva o `fetchedAt` da oferta.

O baseline de registros oficiais anteriores à migration exige o comando local,
confirmado e idempotente:

```powershell
corepack pnpm commercial:snapshots:backfill -- --confirm-local-official-backfill
```

O backfill não chama provider, Redis ou fila. Mineração, sinais promocionais e
filas permanecem fora desta etapa.

O Explorer oficial público permite observar `productOfferV2`, mas não confirma
transporte, assinatura, headers, rate limits, semântica real de paginação ou
cupons para esta conta. **Autenticação e transporte real aguardam credenciais e
documentação liberada para a conta.** Consulte `docs/shopee-affiliate.md`.

É proibido implementar scraping, automação de navegador, endpoints privados ou
mobile, assinatura especulativa, conversão automática de links ou chamada real
à Shopee enquanto essa documentação não estiver disponível.

## Estrutura de pastas

```text
apps/
  api/         API Fastify, servicos de aplicacao, repositorios e testes da API.
  dashboard/   Aplicacao Next.js.
  worker/      Workers BullMQ para pipeline e envios.
packages/
  agents/      Interfaces e agentes Hunter, Score, Copy, Sender e Analytics.
  config/      Validacao de variaveis de ambiente.
  database/    Prisma Client, schema e migrations.
  providers/   Contratos e mocks de integracoes externas.
  queue/       Nomes de filas, jobs e helpers BullMQ.
  shared/      Tipos, erros e utilitarios compartilhados.
```

Arquivos principais na raiz:

- `package.json`: scripts globais do monorepo.
- `pnpm-workspace.yaml`: definicao dos workspaces.
- `turbo.json`: pipeline de tarefas Turborepo.
- `tsconfig.base.json`: configuracao TypeScript base.
- `eslint.config.mjs`: configuracao ESLint.
- `docker-compose.yml`: servicos locais de infraestrutura.
- `.env.example`: variaveis esperadas para desenvolvimento.

## Convencoes de codigo

- Usar TypeScript em apps e pacotes.
- Preferir contratos explicitos entre pacotes, com tipos exportados pelos workspaces.
- Manter regras de negocio dentro dos servicos existentes quando a mudanca pertencer a API.
- Usar providers para isolar integracoes externas.
- Preservar mocks enquanto uma integracao real nao estiver prevista na sprint.
- Manter `WHATSAPP_PROVIDER=mock` como padrao; selecionar `evolution` exige URL, chave e nome da instancia validos.
- Manter o safe mode Evolution ativo por padrao e nunca inserir destinos reais
  em arquivos versionados.
- Manter o comando de teste Evolution isolado e dry-run por padrao; qualquer
  mudanca no caminho confirmado exige revisao de seguranca dedicada.
- Nunca misturar autorizacao de telefone com autorizacao de grupo. Grupos nao
  entram no pipeline/Scheduler e so podem ser descobertos pela rota read-only.
- Nunca acessar variaveis de ambiente dentro de providers nem registrar credenciais em logs ou erros.
- Registrar eventos relevantes com logs estruturados nos servicos e workers.
- Evitar acoplamento direto entre endpoints e detalhes de infraestrutura quando ja houver servico dedicado.
- Manter contratos de repositorio pequenos e especificos, evitando interfaces genericas grandes.
- Implementacoes Prisma devem permanecer atras dos contratos de repositorio.
- Novos servicos de aplicacao devem receber dependencias por construtor/factory.
- Manter formatacao compativel com Prettier e validacao por ESLint.

## Resolucao ESM em desenvolvimento

Pacotes do workspace sao ESM explicitos por `type: "module"`. Seus entrypoints
compilados permanecem em `dist/index.js`, acompanhados por `dist/index.d.ts`.
Declaracoes servem somente ao TypeScript e nunca podem ser carregadas pelo
runtime.

O `apps/api/tsconfig.json` possui paths de build para declaracoes em `dist`. Se
o `tsx` usar esse arquivo automaticamente, ele resolve imports como
`@shopee-auto-affiliate-ai/shared` para `dist/index.d.ts`; esse modulo nao tem
exports de valor e provoca erro ESM para `AppError`. Por isso todos os scripts
`tsx` da API e do worker informam `../../tsconfig.runtime.json`, que mapeia cada
pacote para seu `src/index.ts`.

Regras:

- desenvolvimento e CLIs com `tsx`: usar sempre `tsconfig.runtime.json`;
- build/typecheck: manter o tsconfig proprio de cada pacote;
- producao compilada: resolver JavaScript em `dist`, nunca TypeScript cru;
- nao corrigir falhas de resolucao apagando cache ou `dist`;
- `corepack pnpm --filter @shopee-auto-affiliate-ai/api dev` deve funcionar sem
  build manual anterior;
- `corepack pnpm test:runtime` valida a cadeia API -> providers -> shared,
  consulta `/health` em ambiente mock e encerra o processo filho.

O suporte declarado e Node.js 20.6 ou superior. O hotfix foi reproduzido e
validado no Node.js 24.15.0 com `tsx` 4.23.1.

## Regras de commits

- Commits devem ser pequenos, objetivos e ligados ao escopo da tarefa.
- Usar mensagens no estilo Conventional Commits quando aplicavel.
- Exemplos:
  - `docs: add project documentation for Codex`
  - `feat: add score endpoint`
  - `fix: handle missing product copy`
  - `test: cover pipeline dispatch creation`
- Nao misturar documentacao, refatoracao e mudanca funcional no mesmo commit quando puderem ser separados.
- Antes de commitar, validar o diff e garantir que nao ha mudancas fora do escopo.

## Padroes para testes

- Usar Vitest para testes automatizados.
- Preferir testes focados em servicos, contratos e endpoints.
- Para regras matematicas, cobrir casos limite e valores representativos.
- Para persistencia, validar criacao, atualizacao e erros esperados.
- Para filas, testar enfileiramento, payloads e processamento sem depender de integracoes reais.
- Para providers externos, usar mocks e contratos locais.
- Antes de concluir uma sprint funcional, rodar:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm build` quando o escopo afetar empacotamento ou integracao entre workspaces.

## Definition of Done

Uma tarefa e considerada pronta quando:

- O escopo pedido foi implementado sem mudancas colaterais.
- Regras de negocio existentes foram preservadas, salvo quando a tarefa pedir alteracao explicita.
- Endpoints, filas, banco e testes existentes nao foram alterados fora do escopo.
- O README ou documentacao relevante foi atualizado quando necessario.
- Testes e checks proporcionais ao risco foram executados.
- `git diff --check` passa sem erros.
- O status do Git contem apenas arquivos esperados para a tarefa.
- O commit final possui mensagem clara e aderente as regras do projeto.

## Fluxo de desenvolvimento

1. Confirmar branch atual e estado do Git.
2. Ler README, estrutura de pastas e arquivos diretamente relacionados ao escopo.
3. Planejar a mudanca respeitando os pacotes existentes.
4. Implementar com menor superficie de alteracao possivel.
5. Rodar checks apropriados ao tipo de mudanca.
6. Revisar `git diff` antes de commitar.
7. Fazer commit com mensagem objetiva.
8. Registrar no relatorio final o que mudou e quais validacoes foram feitas.

## Como criar novas Sprints

Cada nova sprint deve ter:

1. Nome curto e objetivo.
2. Objetivo de negocio ou tecnico.
3. Escopo explicito do que entra.
4. Lista explicita do que nao entra.
5. Arquivos ou modulos esperados.
6. Contratos de entrada e saida.
7. Impacto em banco, endpoints, filas e testes.
8. Criterios de aceite.
9. Testes obrigatorios.
10. Pendencias e riscos conhecidos.

Modelo recomendado:

```text
Sprint: <nome>
Objetivo: <resultado esperado>
Entra no escopo:
- <item>
Fora do escopo:
- <item>
Impacto tecnico:
- Banco:
- Endpoints:
- Filas:
- Providers:
Testes:
- <cenario>
Definition of Done:
- <criterio>
```

## Pipeline comercial dry-run

`CommercialPipelineService` e uma camada de aplicacao separada do
`PipelineService` legado. Ele recebe repositorios, calculador de score, gerador
de copy, logger e relogio por injecao. Prisma permanece nos adaptadores; Fastify
apenas valida e delega; BullMQ, Redis, Evolution, Sender e worker nao fazem
parte da composicao.

O catalogo aceita `MOCK`, `MANUAL` ou `OFFICIAL` persistido e 20 candidatos por
padrao, com teto 100. `MOCK`/`MANUAL` preservam a politica `legacy-v1` e score
minimo 70; `OFFICIAL` usa `official-v2` e minimo 60. Elegibilidade exige oferta
ativa, dados comerciais validos e `affiliateLink` HTTP/HTTPS. O ranking
reutiliza `ScoreService.calculate` somente no caminho legado; a politica
oficial pondera comissao, avaliacao, vendas logaritmicas e desconto. O desempate
continua por comissao, vendas, desconto, avaliacao e ID do provider. Nao existe
IA ou aleatoriedade.

Um unico grupo da instancia atual deve estar ativo, disponivel e possuir
fingerprint valido. O historico de dispatch `SENT` e de execucoes futuras
`CONFIRMED` impede repeticao; dry-runs anteriores nao contam como entrega. A
copy usa somente dados persistidos, sem cupom, comissao ou IDs tecnicos, e
preserva o link. Tracking retorna Sub_ids planejados separadamente.

`CommercialPipelineRun` registra somente modo `DRY_RUN` nesta task, com estado,
contagens, rejeicoes, snapshots sanitizados, copy e horario. As rotas
`POST /commercial-pipeline/dry-run`, `GET /commercial-pipeline/runs` e
`GET /commercial-pipeline/runs/:id` nao criam dispatch ou job. O CLI
`corepack pnpm commercial:dry-run` usa `OFFICIAL` somente sobre dados locais e
bloqueia Scheduler e group send. Esse endpoint permanece sem dispatch, job ou
envio mesmo depois da Task 16.2. Runs concluidos e bloqueados preservam a
politica, o limite e o maior score; apenas uma selecao guarda breakdown.

O diagnostico `corepack pnpm commercial:official:diagnose` consulta somente
produtos `OFFICIAL` locais, nao escreve no banco e salva em `.runtime` ignorado
uma distribuicao sanitizada com IDs internos, rejeicoes estruturais e
componentes do `official-v2`. Ele exige zero argumentos, preview, automacao
pausada/desabilitada, Schedulers e envio para grupos desligados.

## Pipeline comercial confirmado

A Task 16.2 preserva o endpoint de dry-run e adiciona a confirmacao separada
`POST /commercial-pipeline/runs/:id/confirm`. O body aceita somente a frase
`CONFIRMAR_ENVIO_COMERCIAL`. A confirmacao atualiza o mesmo run para
`CONFIRMED`, preserva seus snapshots e nao recalcula ranking, produto, grupo ou
copy.

IDs de copy tecnica, dispatch, job e outbox sao derivados do `dryRunId`.
`GeneratedCopy`, `WhatsAppDispatch` `PENDING`, atualizacao do run e
`CommercialDispatchOutbox` `PENDING` sao gravados na mesma transacao. O
publicador separado reconhece um job deterministico existente ou o cria uma
vez; falha de enqueue so termina em `PUBLISHED` quando uma releitura comprova o
job. Qualquer incerteza ou inconsistencia fica `AMBIGUOUS`, sem retry.

`commercial:outbox:status` consulta a evidencia persistida. O reconcile aceita
somente um `outbox-id` e a confirmacao segura, exige modo preview, ambos os
Schedulers desligados e ausencia de worker. Ele nao compoe provider ou
consumer. As rotas `GET /commercial-automation/outbox` e
`GET /commercial-automation/outbox/:id` sao sanitizadas e somente leitura.

O worker `whatsapp-dispatch` existente finaliza o run como `SENT`, `FAILED` ou
`AMBIGUOUS`. Bloqueios comprovadamente anteriores ao request podem terminar em
`FAILED`; falhas/timeout depois do inicio do request ou falha ao persistir
`SENT` conservam o dispatch em `PROCESSING`, exigem investigacao manual e nao
autorizam nova chamada ao provider.
O CLI isolado inicia somente esse consumer e exige provider Evolution, safe
mode, master switch, limites iguais a 1, Scheduler desligado e ausencia de
workers concorrentes. Cupons e Shopee oficial permanecem fora do fluxo.

## Guardrails da automacao comercial

`CommercialAutomationPolicyService` e independente de Fastify, Prisma, BullMQ,
Evolution e Scheduler. Ele recebe configuracao, relogio e tres contratos
pequenos: pausa persistida, historico operacional e diretorio de grupos. O
metodo estavel `evaluateAutomationReadiness()` retorna uma decisao sanitizada
com todos os motivos de bloqueio, contagens, restante diario e proximo horario
calculavel.

A politica exige simultaneamente master switch, ausencia de pausa, janela
permitida no timezone configurado, limites global e por grupo, intervalo minimo,
exatamente um grupo ativo/disponivel da instancia e ausencia de run comercial
ambiguo. `nextAllowedAt` e informado apenas para bloqueios temporais; estados
que exigem acao humana retornam `null`.

O singleton `CommercialAutomationSettings` nasce pausado. Pausar e direto;
retomar exige `RETOMAR_AUTOMACAO_COMERCIAL` e a versao observada. A API expoe
status e mutacoes protegidas de pausa, agenda e configuracao administrativa;
essas rotas rejeitam campos extras, usam CAS quando aplicavel e nunca alteram
arquivos `.env`.

O historico usa `WhatsAppDispatch` `SENT` de grupos e `sentAt` no dia local.
Dry-runs, dispatches `FAILED` e runs sem envio nao contam. Runs com status final
`AMBIGUOUS` ou investigacao pendente bloqueiam. A politica em si nao cria job,
dispatch ou mensagem, mas e consumida pelo Scheduler comercial antes de
sincronizacao, geracao ou envio.

O servidor Fastify usa `HOST=127.0.0.1` por padrao. Exposicao em outra interface
so ocorre com valor explicito no ambiente.

## Scheduler da automacao comercial

A Sprint 17.2 conecta a politica existente a um orquestrador independente de
Fastify e BullMQ. A ordem fixa e politica, uma sincronizacao, um dry-run e,
conforme o modo, preview ou a confirmacao existente. O orquestrador nao duplica
ranking, copy, confirmacao ou envio.

O runtime usa uma infraestrutura dedicada:

- fila `commercial-automation`;
- job `commercial-automation-tick`;
- Scheduler ID `scheduled-commercial-automation`;
- worker com concorrencia 1;
- `attempts: 1`, sem backoff e sem remocao automatica.

Esse bootstrap nao importa nem compoe o `PipelineService` legado. A fila
`product-pipeline`, o job `pipeline-product` e o ID
`scheduled-pipeline-product` permanecem sob o bootstrap anterior. Ligar,
desligar ou consultar o Scheduler comercial nunca altera o legado, e a
inicializacao nao executa tick.

`CommercialAutomationExecution` registra cada tentativa. O `bullMqJobId`
deduplica entregas do mesmo job e uma chave ativa unica impede concorrencia. A
politica tambem bloqueia quando existe run confirmado iniciado, final pendente
ou dispatch comercial `PENDING/PROCESSING`. Falhas anteriores a confirmacao
terminam como `FAILED`; falhas depois que a confirmacao foi tentada terminam
como `AMBIGUOUS` e nao recebem retry automatico.

Execucoes `STARTED` novas persistem `ownerId`, `heartbeatAt` e
`leaseExpiresAt` junto da chave ativa. O orquestrador renova a lease durante o
tick e exige o mesmo owner, status `STARTED`, chave ativa e lease valida antes
de sync, dry-run, confirmacao e finalizacao. Perda de ownership interrompe novas
etapas e deixa a evidencia para recuperacao manual; owners vencidos nunca
reativam a lease.

`STARTED` sem owner/lease, inclusive registros legados, ou com lease vencida e
classificada como stale. A politica separa
`STALE_COMMERCIAL_EXECUTION_EXISTS` de `COMMERCIAL_EXECUTION_IN_PROGRESS`. As
APIs de historico mostram somente `stale`, `heartbeatAt` e `leaseExpiresAt`,
nunca `ownerId`.

Os comandos `commercial:execution:status` e `commercial:execution:recover`
operam uma execucao por vez. Recovery exige preview, automacao desabilitada e
pausada e ambos os Schedulers desligados. Ele nao inicia worker/provider, nao
publica outbox e nao cria job: ausencia comprovada de efeitos termina `FAILED`,
outbox publicado com job comprovado termina `QUEUED`, outbox `PENDING` exige o
reconcile existente e evidencia incerta termina `AMBIGUOUS`.

Os defaults sao Scheduler desligado, cron `0 9 * * *`, timezone
`America/Sao_Paulo` e modo `preview`. `send` so e uma configuracao valida com
Shopee `official`, Evolution, safe mode, envio para grupos habilitado e
Scheduler legado desligado. Mock e importacao manual nunca autorizam envio.
A lease usa 120 segundos e o heartbeat 30 segundos por padrao; os valores devem
ser inteiros positivos e o heartbeat deve ser menor que metade da lease.

A API oferece apenas leitura em `GET /commercial-automation/scheduler`,
`GET /commercial-automation/executions` e
`GET /commercial-automation/executions/:id`. Nao existe rota de trigger ou de
ativacao. O CLI `corepack pnpm commercial:automation:preview` forca preview,
exige ambos os Schedulers desligados e nao compoe Evolution, fila de dispatch
ou worker de WhatsApp.

## Supervisor do sistema local

`apps/system-supervisor` e a camada operacional local da Sprint 17.3. Sua CLI
possui quatro comandos raiz: `system:start`, `system:status`, `system:logs` e
`system:stop`. O nucleo recebe adaptadores de comando, processo, porta, HTTP,
relogio e espera, permitindo testes sem Docker, Redis, Prisma, processos ou
rede reais.

O start usa uma sequencia fixa: validacao da raiz e ferramentas, `docker info`,
compose principal, script `evolution:up`, healthchecks, `prisma generate`,
`prisma migrate deploy`, API, dashboard, worker comercial e, apenas em `send`,
o consumer isolado de dispatch. Ele nunca chama o script raiz `dev`, o bootstrap
legado de `apps/worker/src/index.ts`, um tick comercial, o E2E ou CLIs de
confirmacao. Falhas depois do spawn encerram somente filhos criados pela
tentativa atual. O start aguarda um snapshot final `running`; estado `partial`
durante a propria inicializacao e falha com rollback, nao sucesso operacional.

O runtime persiste em `.runtime/local-system/state.json` apenas metadados
sanitizados. A validacao combina PID, marcador conhecido do entrypoint e horario
de criacao para evitar matar PID reutilizado. Em Windows, a parada tenta sinal
gracioso e depois encerra a arvore somente do PID validado. Os composes recebem
`stop`, nunca `down -v`; o supervisor nao registra nem remove Schedulers.

`system:start` e `system:stop` usam um lock JSON criado exclusivamente no
filesystem. O registro contem somente versao, PID, owner token aleatorio,
horarios de aquisicao/inicio, marcador conhecido e operacao. Um lock ativo exige
PID, marcador e inicio correspondentes; processo ausente ou PID reutilizado e
stale, enquanto formato invalido e erro de inspecao preservam o arquivo. Recovery
rele o owner token e cria uma reivindicacao atomica por hard link antes de
substituir o lock, sem matar processos. A liberacao usa a mesma identidade
imutavel e compara token, PID e inicio, portanto callbacks antigos nao removem
um sucessor. SIGINT/SIGTERM executam esse cleanup quando o runtime consegue
encerrar de forma controlada.

`apps/worker/src/whatsapp-dispatch-runtime.ts` e o unico novo bootstrap de
envio. Ele compoe `createWhatsAppProvider`, `WhatsAppGroupSendPolicy` e
`createWhatsAppDispatchWorker`; por isso consome somente `whatsapp-dispatch` e
preserva `finalizeCommercialPipelineRun`. Nao cria dispatch, job ou mensagem no
bootstrap e nao importa Hunter, Score, Copy, Scheduler ou o pipeline legado.

O status e parcial-safe e consulta os contratos existentes `/health`,
`/scheduler`, `/commercial-automation/status` e
`/commercial-automation/scheduler`, alem da saude dos composes e do contrato
read-only `instance/connectionState` da Evolution. A saida nunca inclui API key,
JID, mensagem, payload, credencial, headers ou resposta externa bruta. Logs
aceitam somente nomes logicos predefinidos e de 1 a 1000 linhas.
O snapshot tambem informa `operationLock` (`unlocked`, `active`, `stale`,
`invalid` ou `unavailable`) e, para registros validos, operacao, PID e horario
de aquisicao, sem owner token e sem alterar o lock.

O comando confirmado abaixo executa uma validação local prolongada com
Scheduler comercial a cada minuto e provider Shopee mock:

`corepack pnpm system:stability:preview -- --confirm-local-preview-stability-test`

Ele comprova
recuperação do worker, API, Redis e PostgreSQL, preserva volumes e bloqueia
dispatch, outbox, filas de envio, estados stale/ambíguos e qualquer modo send.
O único grupo já autorizado fornece a instância somente aos processos filhos;
nenhum grupo ou `.env` é alterado.
O relatório sanitizado fica em
`.runtime/local-system/preview-stability-report.json`; o cleanup restaura a
pausa, remove o Scheduler comercial conhecido e deixa o sistema parado.

## Fundação de nichos e campanhas comerciais

Nichos comerciais são configurações locais determinísticas para ofertas
`OFFICIAL`. Slug, categorias e keywords são normalizados; o matcher trabalha
por tokens/frases, sem regex do usuário, substring arbitrária ou IA.

Uma campanha é identificada pelo fingerprint SHA-256 já existente do JID
canônico do grupo, que não inclui a instância Evolution. O destino âncora é
somente uma referência interna atual, permitindo que uma task futura associe
vários números ao mesmo grupo lógico sem duplicar a campanha.

Campanhas nascem inativas e a ativação explícita exige nicho e destino lógico
elegíveis. Slots usam `floor((fim - início) / cadência)`. IA, sender assignments,
dispatches e envio permanecem fora desta fundação.

## Mineração de promoções comerciais

A mineração consome exclusivamente ofertas `OFFICIAL` e seus snapshots já
persistidos. Ela reaproveita `CommercialNicheMatcher` e `official-v2`, detecta
queda de preço, aumento de desconto, item recém-observado e desconto atual e
ordena o top N de forma determinística. A leitura é paginada por cursor, com
limites de 200 por página e 2.000 por avaliação; resultado truncado pode ser
visualizado, mas não materializado.

Desconto atual não prova queda de preço, e recém-observado descreve as primeiras
24 horas no sistema, não novidade na Shopee. Os sinais não alteram o score de
qualidade `official-v2`; revision, fingerprint e último snapshot precisam ser
coerentes. O fingerprint lógico deduplica inclusive entre números remetentes.

`CommercialPromotionCandidate` relaciona campanha, produto e snapshot e mantém
score, sinais, posição e estados protegidos. A materialização usa transação
serializável curta, lock da campanha, unique campanha + produto e atualizações
condicionais. Candidatos `COPY_READY` e `RESERVED` não são rebaixados e contam
na capacidade ativa. `DISPATCHED` fica fora da capacidade e só pode voltar a
`QUEUED` após o dedupe, sem envio `SENT` recente ao fingerprint lógico. Conflito
é devolvido com código público estável, sem retry.

`protectedCount` reduz a capacidade e provoca rebalanço dos `QUEUED`. Cadência
de 15 minutos ainda não registra Scheduler; múltiplos remetentes continuam fora
desta etapa, e a IA é consumida somente pela camada validada abaixo.

As rotas `POST /commercial/campaigns/:id/mining-preview`, `POST
/commercial/campaigns/:id/mine` e `GET /commercial/campaigns/:id/queue` expõem
somente relatórios sanitizados. A confirmação de escrita é
`MINERAR_PROMOCOES`. As CLIs `commercial:campaign:preview` e
`commercial:campaign:mine` não compõem provider, fila ou worker; a escrita local
exige `--confirm-local-promotion-mining`, preview, automação pausada/desabilitada,
Schedulers e group send desligados, fora de CI e sem worker de dispatch.

## Geração validada de copy promocional por IA

O fluxo isolado é: preflight/configuração → contexto `QUEUED` → fingerprint
canônico → cache ou claim `STARTED` → uma chamada à Responses API fora da
transação → validação estrutural e factual → montagem determinística →
revalidação serializável → `GeneratedCopy AI`, attempt `SUCCEEDED` e candidato
`COPY_READY` atômicos.

O provider usa Structured Output estrito, prompt
`commercial-promotion-copy-v2`, validação
`commercial-promotion-copy-validation-v2`, `store=false`, zero retry e nenhuma
tool. Produto, loja e nicho são normalizados e delimitados como dados não
confiáveis. A IA nunca recebe link, ID externo, fingerprint ou credencial e só
gera `headline`, `body`, `cta` e hashtags sem números ou fatos comerciais. O
sistema insere produto, loja, preço, desconto, sinal comprovado e exatamente o
link afiliado atual.

O fingerprint inclui versões, provider/modelo, campanha, nicho, candidato,
produto, snapshot, fatos comerciais, limite e hash do link, nunca o link bruto.
O cache exige origem AI, mesmo provider/modelo/versões/produto/snapshot e o
limite atual. `FAILED` registra falha confirmada sem resultado utilizável;
`AMBIGUOUS` preserva incerteza de chamada ou persistência. Ambos bloqueiam nova
tentativa para o mesmo input, assim como `STARTED`; nenhuma tentativa é apagada.

`CommercialCopyService`, confirmação comercial, Sender e os quatro campos
históricos de `GeneratedCopy` permanecem compatíveis por meio do default
`LEGACY_TEMPLATE`. Preview e respostas públicas substituem o link por
`[LINK_AFILIADO]`, e nenhum caminho desta camada compõe fila, Redis, Scheduler,
dispatch, outbox, WhatsApp ou Evolution.
