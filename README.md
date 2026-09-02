# shopee-auto-affiliate-ai

Monorepo com pnpm workspaces e Turborepo para automatizar um pipeline afiliado modular da Shopee com agentes de IA, filas e dashboard.

## Documentacao

- [CODEX.md](CODEX.md): guia de organizacao, arquitetura, convencoes e fluxo de desenvolvimento.
- [AGENTS.md](AGENTS.md): responsabilidades, entradas, saidas, dependencias e proximos passos dos agentes.

## Estrutura

- `apps/api`: API Fastify em TypeScript com `GET /health` e `POST /hunter/run`.
- `apps/worker`: worker BullMQ com job de teste `pipeline-product`.
- `apps/dashboard`: Next.js App Router com Tailwind e base shadcn/ui.
- `packages/database`: Prisma Client e schema PostgreSQL para leads de produtos.
- `packages/queue`: conexão Redis, filas e nomes dos jobs.
- `packages/agents`: interfaces e implementações iniciais de Hunter, Score, Copy, Sender e Analytics.
- `packages/providers`: contratos para Hunter/Shopee, OpenAI e Evolution API com mocks.
- `packages/config`: validação das variáveis de ambiente com Zod.
- `packages/shared`: tipos, erros e utilitários comuns.

## Requisitos

- Node.js 20.6+; o runtime tambem e validado no Node.js 24.15.0.
- pnpm 9.12.3 via Corepack; nao e necessario instalar pnpm globalmente.
- Docker e Docker Compose

## Como executar

### Migrations Prisma

Instalação nova:

```powershell
corepack pnpm db:migrations:verify-clean
corepack pnpm db:deploy
```

Banco existente criado antes da baseline:

```powershell
corepack pnpm db:baseline:status
corepack pnpm db:baseline:adopt -- --confirm-existing-database
corepack pnpm db:deploy
```

`db:baseline:adopt` é uma operação única de histórico: registra a baseline
como aplicada depois de validar o banco existente e não modifica tabelas ou
dados comerciais.

```bash
cp .env.example .env
corepack pnpm install
docker compose up -d
corepack pnpm --filter @shopee-auto-affiliate-ai/database db:generate
corepack pnpm dev
```

A API ficará disponível em `http://localhost:3333/health` e o processo de
dashboard de desenvolvimento usará `http://localhost:3000`. O bind padrão da
API é local, com `HOST=127.0.0.1`; o painel autenticado pelo navegador exige a
configuração server-side descrita abaixo.

Para executar cada parte separadamente:

```bash
corepack pnpm --filter @shopee-auto-affiliate-ai/api dev
corepack pnpm --filter @shopee-auto-affiliate-ai/worker dev
corepack pnpm --filter @shopee-auto-affiliate-ai/dashboard dev
```

Com o `.env` local ja configurado, a API inicia com esse unico comando depois
de `git pull` e `corepack pnpm install --frozen-lockfile`; nao e necessario
compilar os pacotes antes. O atalho `corepack pnpm dev:api` executa o mesmo
fluxo.

No uso normal pelo navegador, o dashboard chama o proxy same-origin `/api`, que
usa `DASHBOARD_API_URL` e `LOCAL_API_AUTH_TOKEN` somente no processo do servidor.
O perfil diário oficial configura esses valores localmente; o `.env.example`
não provisiona token operacional. Em testes ou caminhos server-side que usem o
fallback direto, `NEXT_PUBLIC_API_URL` pode apontar para a API local, mas isso
não substitui a autenticação do proxy no navegador:

```env
NEXT_PUBLIC_API_URL=http://localhost:3333
```

Nunca coloque `EVOLUTION_API_KEY` ou outros segredos em variaveis
`NEXT_PUBLIC_*`.

Exceto por `/health`, as rotas da API exigem `Authorization: Bearer <token
local>`. Os exemplos `curl` abaixo são referências de desenvolvimento e não
incluem credenciais; não coloque o token real em documentação, argumentos de
atalho ou variáveis `NEXT_PUBLIC_*`. Para a operação diária, use o proxy
autenticado do dashboard.

## Uso diario

Para operar o sistema sem terminal:

1. Dê dois cliques em **Shopee Affiliate**; o atalho verifica o ambiente,
   delega o ciclo ao supervisor e abre o dashboard quando API e painel estão
   prontos.
2. Use **Automação** para conferir o estado e ligar ou desligar a automação.
   Ligar a automação remove somente a pausa persistida; iniciar o sistema não
   liga a automação por conta própria.
3. Ajuste horário, intervalo, stagger e limites no painel.
4. Use **Números e grupos** para acompanhar instâncias, grupos e assignments.
5. Feche o navegador quando quiser; o sistema continua ligado. Para encerrar
   a topologia local, use o atalho **Shopee Affiliate - Encerrar**.

O terminal fica reservado para manutenção e desenvolvimento. O atalho de
encerramento usa o mesmo supervisor oficial e não força a morte de processos.
No perfil diário instalado pelo launcher, a API local usa a porta `3433` e o
dashboard usa `3000`; essa configuração fica no ambiente do supervisor e não
precisa ser editada pelo usuário.

## Hunter Agent

O Hunter Agent pode ser executado manualmente pela API:

```bash
curl -X POST http://localhost:3333/hunter/run \
  -H 'Content-Type: application/json' \
  -d '{"categoria":"Eletrônicos","notaMin":4.5}'
```

A resposta informa quantos produtos foram encontrados, criados e atualizados:

```json
{
  "encontrados": 5,
  "novos": 5,
  "atualizados": 0,
  "tempoExecucao": "20ms"
}
```

Filtros opcionais aceitos: `categoria`, `precoMin`, `precoMax`, `descontoMin`, `notaMin`, `vendidosMin` e `comissaoMin`.

## Scripts

- `corepack pnpm dev`: inicia os apps em modo desenvolvimento via Turborepo.
- `corepack pnpm dev:api`: inicia somente a API com a resolucao ESM de desenvolvimento.
- `corepack pnpm test:runtime`: inicia a API em ambiente controlado, consulta `/health`
  e encerra o processo filho.
- `corepack pnpm system:stability:preview`: valida ciclos reais agendados em
  preview, reinicializações e indisponibilidades temporárias; exige a
  confirmação `--confirm-local-preview-stability-test`.
- `corepack pnpm evolution:init`: cria a configuração local ignorada da Evolution API
  com segredos aleatórios, sem exibi-los.
- `corepack pnpm evolution:up`: sobe Evolution API, PostgreSQL e Redis isolados.
- `corepack pnpm evolution:status`: mostra estado, saúde e porta da stack Evolution.
- `corepack pnpm evolution:logs`: mostra as últimas 200 linhas dos containers, sem
  imprimir o ambiente.
- `corepack pnpm evolution:restart`: reinicia a stack Evolution sem apagar dados.
- `corepack pnpm evolution:down`: para a stack Evolution e preserva os volumes.
- `corepack pnpm whatsapp:group-test`: valida o diretorio de grupos em dry-run, sem
  criar dispatch, job, worker ou mensagem.
- `corepack pnpm shopee:import -- --file caminho.json`: valida importacao manual em
  dry-run; somente `--confirm-import` permite persistir.
- `corepack pnpm commercial:automation:preview`: executa um unico preview
  comercial local, com os Schedulers desligados e sem enviar mensagem.
- `corepack pnpm commercial:automation:worker`: inicia somente o Scheduler e o
  consumer comerciais; com o default desabilitado, remove apenas seu proprio
  agendamento e permanece sem tick de bootstrap.
- `corepack pnpm commercial:official:diagnose`: explica localmente a
  elegibilidade e a distribuicao de score dos produtos `OFFICIAL` persistidos,
  sem provider externo ou escrita no banco.
- `corepack pnpm build`: compila todos os pacotes e aplicações.
- `corepack pnpm lint`: executa ESLint.
- `corepack pnpm typecheck`: executa TypeScript sem emissão.
- `corepack pnpm test`: executa os testes mínimos.

## Runtime ESM dos workspaces

Pacotes compilados continuam com contrato ESM por `type: "module"`, JavaScript
em `dist/index.js` e tipos em `dist/index.d.ts`. Typecheck e build podem resolver
as declaracoes de `dist`, mas arquivos `.d.ts` nunca sao entrypoints de runtime.

Todo comando executado por `tsx` usa `tsconfig.runtime.json`, que mapeia os
pacotes internos explicitamente para `packages/*/src/index.ts`. Isso evita que o
loader aplique os `paths` de build da API e tente executar
`packages/shared/dist/index.d.ts` como modulo vazio. O desenvolvimento carrega
fontes TypeScript; a execucao compilada continua apontando para JavaScript em
`dist`.

O erro ficou evidente no Node.js 24.15.0, mas era uma ambiguidade anterior de
resolucao, nao um cache corrompido. Limpar `dist`, reiniciar o terminal ou
instalar pnpm globalmente nao faz parte da solucao.

O smoke test `apps/api/test/runtime-esm.test.ts` inicia `src/server.ts` com o
loader local do `tsx`, porta livre e ambiente mock controlado. Ele exige HTTP
200 e `{ "status": "ok", "service": "api" }` em `/health`, confirma que o
processo permanece ativo e o encerra sem Scheduler, Evolution, pipeline ou
mensagens.

## Infraestrutura local da Evolution API

A infraestrutura isolada fica em `infra/evolution` e usa três containers:

- `shopee-evolution-api`, com a imagem pública fixada
  `evoapicloud/evolution-api:v2.3.7`;
- `shopee-evolution-postgres`, banco exclusivo sem porta publicada no host;
- `shopee-evolution-redis`, cache exclusivo sem porta publicada no host.

Para preparar e iniciar no Windows/PowerShell:

```powershell
corepack pnpm evolution:init
corepack pnpm evolution:config
corepack pnpm evolution:pull
corepack pnpm evolution:up
corepack pnpm evolution:status
```

A API fica em `http://localhost:8080` e a rota pública `/` funciona como status
oficial da versão 2.3.7. A configuração real fica somente em
`infra/evolution/.env.local`, que está ignorado pelo Git e nunca deve ser enviado
ao GitHub. PostgreSQL, Redis, volumes e rede usam nomes próprios e não colidem
com o compose principal.

A 2.3.7 foi escolhida por ser a última release pública estável da linha 2.3.x,
anterior à ativação remota obrigatória da 2.4.0, e por incorporar a correção da
migração Kafka publicada na 2.3.5. Sua licença é Apache 2.0 com condições
adicionais de preservação da marca/copyright no frontend e aviso visível de uso
da Evolution API; descumprir essas condições pode exigir licença comercial.
Consulte o [guia operacional completo](infra/evolution/README.md).

Esta stack apenas inicia a infraestrutura. Ela não cria instância, não gera QR
Code, não conecta WhatsApp, não executa pipeline ou Scheduler e não envia
mensagens. Um próximo passo deve revisar manualmente ambiente, instância
fictícia, safe mode, allowlist e limite antes de decidir criar e conectar uma
instância em uma task separada e controlada.

## Desenvolvimento sem integrações reais

O modo padrão não implementa scraping nem chamadas externas reais. Os pacotes expõem interfaces e mocks, e o worker somente seleciona Evolution API quando `WHATSAPP_PROVIDER=evolution` é configurado explicitamente.

## Fundação Shopee Affiliate

A Task 15.1 adiciona um contrato independente de HTTP/Prisma para ofertas, os
providers `mock`, `manual` e `official`, sincronização limitada, importação
manual com preview, catálogo público, domínio local de cupons e preview de copy
sem envio. O provider mock continua sendo o padrão e usa somente dados
fictícios com URLs `example.invalid`.

O provider oficial implementa o contrato GraphQL documentado pela Shopee com
signer SHA-256 puro, `fetch` e clock injetáveis, timeout/abort e resposta
limitada. A configuração fica apenas no `.env` ignorado. O preflight exige modo
preview, automação pausada, ambos os Schedulers desligados e nenhum worker/job
de dispatch; o sync confirmado faz somente uma página de até cinco produtos,
sem retry, pipeline ou WhatsApp. Não há scraping, consulta de endpoints
privados/mobile ou geração especulativa de links. A captura documental local é
efêmera, limitada aos hosts oficiais e salva apenas artefatos sanitizados
ignorados pelo Git.

Rotas locais:

- `POST /shopee/offers/sync`;
- `GET /shopee/offers` e `GET /shopee/offers/:id`;
- `POST /shopee/offers/import/validate` e `POST /shopee/offers/import`;
- `POST /shopee/offers/:id/copy-preview`;
- CRUD `/coupons` com confirmação manual.

Produtos agora são lidos diretamente do catálogo da API no dashboard. A tela
oferece filtros, sincronização, importação JSON validada e preview marcado
`PREVIEW — NAO ENVIADO`; Cupons possui uma tela local separada. Nenhuma dessas
ações cria dispatch, chama fila ou envia WhatsApp.

Consulte [docs/shopee-affiliate.md](docs/shopee-affiliate.md) para os campos
confirmados em `productOfferV2`, assinatura, transporte, formato JSON/CSV,
configuração, score, Sub_ids, cupons e limitações operacionais da Sprint 18.1.

### Histórico comercial das ofertas oficiais

O sync de `OFFICIAL` persiste o estado atual e seu
`CommercialOfferSnapshot` atomicamente. O fingerprint canônico considera
preços, desconto, comissão, vigência e indisponibilidade: A → B → A cria as
revisions 1, 2 e 3, mas A → A não duplica snapshot. Rating e vendas são
observados no snapshot quando uma revision é criada e não causam revision
isoladamente. `capturedAt` usa o `fetchedAt` original; revision representa uma
mudança comercial, não uma nova coleta.

Produtos oficiais anteriores à migration são inicializados somente pelo
backfill local explícito e idempotente:

```powershell
corepack pnpm commercial:snapshots:backfill -- --confirm-local-official-backfill
```

O comando exige preview, automação pausada/desabilitada, ambos os Schedulers e
group send desligados e zero worker de dispatch. Ele não chama a Shopee, Redis,
Evolution ou WhatsApp. Mineração, sinais e filas continuam fora desta etapa.

## Score Engine

O Score Engine calcula e persiste um score matemático de 0 a 100 para cada produto salvo, sem uso de IA, OpenAI, WhatsApp, Analytics ou ranking.

Pesos utilizados:

- Comissão: 35% (normalizada de 0 a 20%).
- Avaliações: 25% (normalizada de 0 a 5).
- Vendidos: 20% (normalizado de 0 a 10000+).
- Desconto: 10% (normalizado de 0 a 100%).
- Loja oficial: 10% (0 ou 100, quando o nome da loja contém `oficial`).

Execute manualmente pela API:

```bash
curl -X POST http://localhost:3333/score/run
```

Resposta esperada:

```json
{
  "produtosProcessados": 40,
  "maiorScore": 82,
  "menorScore": 21,
  "mediaScore": 48.5,
  "tempoExecucao": "20ms"
}
```

O processamento atualiza os campos `score` e `scoreUpdatedAt` em `ProductLead`.

### Política comercial por origem

O Score Engine legado permanece inalterado. O pipeline comercial usa
`legacy-v1` para `MOCK` e `MANUAL`, com minimo padrao 70, e a politica
deterministica `official-v2` para `OFFICIAL`, com minimo padrao 60. Um
`minimumScore` explicito sempre prevalece.

`official-v2` atribui 35 pontos a comissao normalizada ate 20%, 25 pontos a
avaliacao ate 5, 20 pontos a vendas normalizadas por `log10(1 + vendas)` ate
10.000 e 20 pontos ao desconto ate 100%. Somente o score final e arredondado.
Preco, valor de comissao, nome/tipo da loja e categoria nao entram na formula.

```powershell
corepack pnpm commercial:official:diagnose
```

O diagnostico aceita zero argumentos, consulta somente o banco local em
preview e grava o relatorio sanitizado em
`.runtime/local-system/official-offer-diagnosis.json`.

## Relatório da Sprint - Score Engine

### Arquivos criados

- `apps/api/src/score-service.ts`: serviço de cálculo, execução em lote, persistência, logs estruturados e tratamento de erros.
- `apps/api/test/score.test.ts`: cobertura de cenários de score e endpoint `POST /score/run`.

### Arquivos modificados

- `apps/api/src/app.ts`: registro do endpoint `POST /score/run`.
- `packages/database/prisma/schema.prisma`: adição de `scoreUpdatedAt` ao modelo `ProductLead`.
- `packages/agents/src/index.ts`: alinhamento do cálculo legado de score aos pesos matemáticos desta sprint.
- `packages/agents/src/score.test.ts`: atualização do teste existente para o novo cálculo.
- `README.md`: documentação do Score Engine e relatório da sprint.

### Testes

- Produto excelente.
- Produto médio.
- Produto ruim.
- Produto sem vendas.
- Produto sem comissão.
- Produto nota máxima.
- Produto loja oficial.
- Endpoint `POST /score/run` com persistência de `score` e `scoreUpdatedAt`.

### Decisões

- Comissão aceita valores fracionários (`0.2`) ou percentuais (`20`) e é normalizada para o intervalo 0-20%.
- Loja oficial é identificada matematicamente pelo texto `oficial` no nome da loja, gerando 0 ou 100 no componente.
- Scores são arredondados, limitados entre 0 e 100, e persistidos sem criar ranking nem remover produtos.
- O endpoint retorna estatísticas agregadas apenas da execução atual.

### Problemas

- Não havia migrações Prisma no repositório; o schema foi atualizado diretamente e o client é gerado no build.

### Pendências

- Criar migração Prisma formal quando o fluxo de migrações do projeto for definido.
- Conectar o endpoint a uma base PostgreSQL real nos ambientes de staging/produção.

## Copy Engine

O Copy Engine gera textos promocionais para produtos já persistidos, usando somente templates locais. Ele não utiliza OpenAI, LLM, IA, WhatsApp ou Analytics.

Execute manualmente pela API:

```bash
curl -X POST http://localhost:3333/copy/generate \
  -H 'Content-Type: application/json' \
  -d '{"productId":"ID_DO_PRODUTO"}'
```

Resposta esperada:

```json
{
  "titulo": "🔥 Oferta Relâmpago: Fone Bluetooth por R$ 99,90",
  "mensagem": "Corre! Fone Bluetooth na categoria Eletrônicos está com 25% de desconto, nota 4,8 e comissão de 12%.",
  "cta": "Garanta agora antes que a oferta acabe!",
  "hashtags": "#OfertaRelampago #Eletronicos #Desconto25"
}
```

A cada chamada, uma nova linha é criada na tabela `GeneratedCopy`; registros antigos não são atualizados.

Templates disponíveis:

- 🔥 Oferta Relâmpago
- 💥 Desconto Imperdível
- 🚚 Frete Grátis
- ⭐ Mais Vendido
- ❤️ Produto Campeão
- 🎁 Achado do Dia
- ⚡ Promoção Limitada
- 🏆 Melhor Custo Benefício

Placeholders suportados pelo `TemplateEngine`: `{{nome}}`, `{{preco}}`, `{{desconto}}`, `{{comissao}}`, `{{categoria}}` e `{{nota}}`.

## Relatório da Sprint - Copy Engine

### Arquivos criados

- `apps/api/src/copy-service.ts`: serviço de geração de copy, `TemplateEngine`, 8 templates, logs estruturados, persistência e tratamento de erros.
- `apps/api/test/copy.test.ts`: testes de substituição de placeholders, cobertura de todos os templates, persistência e endpoint `POST /copy/generate`.

### Arquivos modificados

- `apps/api/src/app.ts`: registro do endpoint `POST /copy/generate` com validação de `productId` e respostas de erro.
- `packages/database/prisma/schema.prisma`: criação do modelo `GeneratedCopy` relacionado a `ProductLead`.
- `README.md`: documentação do Copy Engine e relatório da sprint.

### Testes

- Substituição de placeholders conhecidos e preservação de placeholders desconhecidos.
- Renderização de todos os 8 templates sem placeholders pendentes.
- Persistência de uma nova copy por chamada.
- Erro para produto inexistente.
- Endpoint `POST /copy/generate` com resposta no formato esperado.
- Validação de `productId` obrigatório.

### Decisões

- A escolha do template é aleatória a cada geração para variar as copies sem IA.
- Valores monetários e percentuais são formatados em `pt-BR`.
- Hashtags são normalizadas para remover acentos e caracteres inválidos.
- O histórico é preservado criando sempre novos registros em `GeneratedCopy`.

### Problemas

- Não havia migrações Prisma no repositório; o schema foi atualizado diretamente, mantendo o padrão das sprints anteriores.

### Pendências

- Criar migração Prisma formal quando o fluxo de migrações do projeto for definido.

## WhatsApp Sender

O módulo de envio usa o provider selecionado no bootstrap do worker. `WHATSAPP_PROVIDER=mock` continua sendo o padrão seguro e não faz chamadas HTTP nem envia mensagens reais. O pipeline cria registros `WhatsAppDispatch` pendentes e enfileira jobs `whatsapp-dispatch`; o worker consome esses jobs e chama o `SenderService` com uma única instância do provider injetada.

### Arquitetura de envio

1. `pipeline-product` executa Hunter, persistência, Score e Copy.
2. Após cada `GeneratedCopy`, o pipeline busca `WhatsAppDestination` ativos.
3. Para cada combinação copy + destino ativo, cria um `WhatsAppDispatch` `PENDING`.
4. Cada dispatch é enfileirado em `whatsapp-dispatch`.
5. O worker executa `SenderService`, que adquire atomicamente apenas um dispatch
   `PENDING`, muda para `PROCESSING`, incrementa `attemptCount` e chama o
   provider.
6. Sucesso persistido muda para `SENT`; bloqueio comprovadamente anterior ao
   request pode mudar para `FAILED`. Resultado externo incerto ou falha ao
   persistir `SENT` conserva `PROCESSING` e exige investigacao manual.
7. O BullMQ preserva `attempts: 3` e backoff exponencial nos jobs normais, mas
   retries/redeliveries de `PROCESSING` ou `FAILED` nao chamam o provider de
   novo. Nao ha retry manual no servico.

A mensagem pública enviada é formada por título, mensagem, CTA e hashtags. Comissão de afiliado não é adicionada pelo sender ao payload público.

### Destinos

`WhatsAppDestination` representa destinos individuais do provider. Grupos sao
descobertos somente pelo diretorio seguro descrito adiante e nunca podem ser
cadastrados por este endpoint legado:

```json
{
  "name": "Grupo de ofertas",
  "destination": "mock-group-01",
  "active": true
}
```

Destinos inativos permanecem cadastrados, mas não recebem dispatch no pipeline.

### Endpoints

- `POST /whatsapp/destinations`: cria destino.
- `GET /whatsapp/destinations`: lista destinos.
- `PATCH /whatsapp/destinations/:id`: altera `name`, `destination` e/ou `active`.
- `GET /whatsapp/dispatches`: lista envios com filtros opcionais `status`, `destinationId` e `productId`.
- `GET /whatsapp/dispatches/:id`: consulta um envio com produto, copy e destino.
- `POST /pipeline/run`: enfileira `pipeline-product`.
- `GET /pipeline/jobs/:id`: consulta status do job de pipeline.

### Filas

- `product-pipeline` / job `pipeline-product`: orquestra Hunter, Score, Copy e criação dos dispatches.
- `whatsapp-dispatch` / job `whatsapp-dispatch`: payload `{ "dispatchId": "..." }`, com `attempts: 3`, backoff exponencial, `removeOnComplete` e `removeOnFail` limitados; somente a aquisicao atomica inicial de `PENDING` autoriza a chamada externa.

### Scheduler do pipeline

`SchedulerConfig` e `PipelineScheduler` definem o contrato para agendamentos do
pipeline sem depender de BullMQ. O adaptador `BullMqPipelineScheduler` usa a
fila `product-pipeline`, um ID estavel e a API de Job Schedulers para registrar,
consultar ou remover um job recorrente `pipeline-product`. Os filtros opcionais
sao preservados no payload.

```env
SCHEDULER_ENABLED=false
SCHEDULER_CRON=0 8 * * *
SCHEDULER_TIMEZONE=America/Sao_Paulo
```

O Scheduler permanece desativado por padrao. Cron e timezone so sao exigidos
quando `SCHEDULER_ENABLED=true`. O bootstrap do worker cria uma unica instancia
do adaptador usando a conexao e a fila `product-pipeline` compartilhadas. Quando
habilitado, registra o job recorrente com ID estavel; quando desabilitado,
remove somente esse agendamento conhecido para evitar que um cron antigo
permaneca ativo.

O worker so inicia os consumidores depois de confirmar o estado configurado do
Scheduler. Falhas de registro ou remocao interrompem o bootstrap. O shutdown
fecha workers, fila e conexao, mas preserva o agendamento registrado. O endpoint
manual `POST /pipeline/run` continua disponivel, e o Scheduler nunca chama o
`PipelineService` diretamente.

`GET /scheduler` consulta somente o estado do agendamento conhecido e retorna:

```json
{
  "enabled": true,
  "status": "registered",
  "jobId": "scheduled-pipeline-product",
  "queue": "product-pipeline",
  "jobName": "pipeline-product",
  "cronExpression": "0 8 * * *",
  "timezone": "America/Sao_Paulo",
  "nextRunAt": "2026-07-25T11:00:00.000Z"
}
```

O endpoint e somente leitura: nao registra, edita ou remove cron e nao executa
o pipeline. Quando o estado nao pode ser consultado, responde HTTP 503 com o
codigo `SCHEDULER_STATUS_UNAVAILABLE`, sem detalhes do Redis ou stack.

O cliente do dashboard mantém `GET /scheduler` pela camada HTTP centralizada
para o agendamento legado. No caminho diário, a agenda comercial é exibida por
`/commercial-automation/scheduler` em **Início**, **Automação** e
**Diagnóstico avançado**. Em ambos os casos, o dashboard apenas consulta o
estado: registro, cron, enabled e shutdown continuam sob autoridade do
worker/supervisor. HTTP 503 aparece como indisponibilidade, nunca como Scheduler
desativado, e nenhum segredo ou detalhe interno e renderizado.

### Provider mock

`MockWhatsAppProvider` valida destino e mensagem não vazios, gera `externalMessageId` fictício, retorna `status: "sent"`, registra chamadas em memória para testes e permite simular falhas.

### Evolution API preparada

O `EvolutionApiWhatsAppProvider` usa o contrato confirmado da Evolution API
2.3.7 fixada na infraestrutura local para
`POST /message/sendText/{instanceName}`: payload plano
`{ "number": "<destination>", "text": "<message>" }`, header `apikey`,
`Content-Type: application/json`, timeout, mapeamento de erros e resposta
interna segura. Nao existe fallback automatico para `textMessage` ou outro
formato, pois uma segunda tentativa poderia duplicar a mensagem. A factory
`createWhatsAppProvider` mantem `mock` como padrao e aceita `evolution` apenas
com configuracao completa.

```env
WHATSAPP_PROVIDER=mock
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=replace-with-your-api-key
EVOLUTION_INSTANCE_NAME=affiliate-bot
EVOLUTION_SAFE_MODE=true
EVOLUTION_ALLOWED_DESTINATIONS=
EVOLUTION_MAX_MESSAGES_PER_BOOT=1
WHATSAPP_GROUP_SEND_ENABLED=false
WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN=1
```

O worker usa `loadConfig` no bootstrap, cria o provider e o
`EvolutionSendGuard` uma vez por meio de `createWhatsAppProvider` e injeta a
mesma instancia nos jobs. O safe mode fica ativo por padrao, exige que o
destino normalizado esteja na allowlist e limita os requests iniciados durante
a vida do processo. A allowlist vazia bloqueia todos os envios Evolution e o
limite padrao e 1. Requests que chegaram ao cliente HTTP contam mesmo quando
terminam em timeout ou erro HTTP; bloqueios anteriores ao HTTP nao contam.

O provider `mock` ignora essas configuracoes e continua sem HTTP. Desativar o
safe mode exige `EVOLUTION_SAFE_MODE=false` explicito e preserva o comportamento
anterior do provider Evolution; credenciais presentes nunca desativam a
protecao automaticamente. Nenhuma mensagem real ou request externo foi
executado na task que introduziu esse mecanismo. A proxima task devera criar um
fluxo explicito, isolado e auditavel para um unico teste real.

Testes usam mock ou cliente HTTP injetado e nunca usam credenciais reais. Nunca versione um arquivo `.env`, credenciais reais ou números reais de WhatsApp.

### Teste isolado de uma mensagem

O comando abaixo e isolado do bootstrap normal do worker e funciona em dry-run
por padrao:

```bash
corepack pnpm evolution:test-message
```

O dry-run carrega e valida a configuracao, cria uma unica instancia do provider
Evolution com o guard existente, mostra apenas um resumo mascarado e encerra sem
chamar `sendMessage` ou HTTP. Ele nao inicia workers BullMQ, nao acessa Redis,
Prisma ou banco, nao registra Scheduler e nao usa pipeline, dispatch, copy ou
produto.

Um envio controlado exige exclusivamente a flag exata abaixo, sem confirmacao
interativa e sem depender de `pnpm` global no Windows:

```bash
corepack pnpm evolution:test-message -- --confirm-one-real-message
```

Esse modo nunca pode executar em CI e exige simultaneamente:

- `WHATSAPP_PROVIDER=evolution` e credenciais Evolution completas somente no
  `.env` local nao versionado.
- `EVOLUTION_SAFE_MODE=true`.
- Exatamente um destino em `EVOLUTION_ALLOWED_DESTINATIONS`; o destino nao pode
  ser informado por argumento e aparece apenas mascarado.
- `EVOLUTION_MAX_MESSAGES_PER_BOOT=1`.
- `SCHEDULER_ENABLED=false`.

A mensagem e fixa: "Teste controlado do sistema Afiliado Shopee. Nenhuma ação
é necessária." Nao sao aceitos texto personalizado, dados de produto, links,
hashtags ou copies. O comando tambem aceita a flag direta quando invocado no
workspace do worker; qualquer separador, flag parcial ou argumento adicional e
bloqueado. Se houver timeout, erro de rede, HTTP 5xx ou resultado ambiguo, e
proibido repetir manual ou automaticamente o envio.

Na validacao da Task 13.4, a stack 2.3.6 e a instancia foram confirmadas como
saudaveis/conectadas, mas o arquivo local ignorado mantinha o provider `mock` e
a allowlist vazia. O dry-run bloqueou antes do provider e nenhuma mensagem real
foi enviada. Nenhuma credencial ou destino foi registrado neste repositorio.

### Teste E2E controlado de dispatch

O fluxo completo `WhatsAppDispatch -> BullMQ -> worker -> SenderService ->
EvolutionApiWhatsAppProvider -> Evolution API -> WhatsApp` possui um comando
isolado e em dry-run por padrao:

```bash
corepack pnpm whatsapp:e2e-test
```

O comando carrega automaticamente o `.env` da raiz sem sobrescrever variaveis
de processo, valida Evolution API 2.3.7, instancia `afiliado-shopee-local`,
PostgreSQL e Redis principais e mostra somente um resumo mascarado. O dry-run
nao cria registros, jobs ou workers e nao chama o endpoint de envio.

O unico caminho real exige exatamente:

```bash
corepack pnpm whatsapp:e2e-test -- --confirm-one-real-dispatch
```

Esse caminho e bloqueado em CI e exige provider `evolution`, safe mode ativo,
uma unica entrada na allowlist, limite igual a 1 e Scheduler desativado. Ele
tambem bloqueia se detectar workers ou pipeline ativos. O destino vem somente
da allowlist; argumentos de destino, texto ou flags adicionais sao rejeitados.

Os registros usam IDs e nomes tecnicos deterministas. O destino E2E e inativo
para nao participar do pipeline normal. Qualquer dispatch E2E anterior em
`SENT`, `FAILED`, `PENDING` ou estado inesperado bloqueia permanentemente uma
nova tentativa. O job preservado usa `attempts: 1`, sem backoff e sem remocao
automatica. Somente o consumer `whatsapp-dispatch` e iniciado; API publica,
pipeline, Scheduler, Hunter, Score e Copy nao sao iniciados.

A mensagem entregue ao provider e exatamente: "Teste E2E controlado do sistema
Afiliado Shopee. Nenhuma ação é necessária." O endpoint existente
`GET /whatsapp/dispatches/:id` e validado internamente por `app.inject` e agora
mascara o destino na resposta de detalhe. Timeout, erro de rede, HTTP 5xx ou
resultado ambiguo exigem investigacao manual e nunca autorizam retry ou nova
execucao.

Na preparacao local da Task 13.5, a stack e a instancia foram validadas como
saudaveis/open, e PostgreSQL e Redis principais ficaram disponiveis. O `.env`
raiz continuou com `mock`, instancia de exemplo e allowlist vazia; portanto o
comando permaneceu bloqueado antes de qualquer escrita ou envio. Resultado
sanitizado: zero mensagens reais e nenhum segredo versionado.

### Diretorio seguro de grupos

O diretorio usa exclusivamente o contrato read-only confirmado na tag oficial
2.3.7:

```text
GET /group/fetchAllGroups/:instanceName?getParticipants=false
apikey: <segredo somente no servidor>
```

`getParticipants` e obrigatorio nessa versao. A resposta e um array com campos
como `id`, `subject`, `size`, tempos e configuracoes do grupo; `participants` so
e acrescentado quando a query recebe `true`, caminho que este projeto nunca
usa. O provider mapeia apenas `id` para armazenamento interno, `subject` para
nome e `size` para contagem opcional. Descricao, owner, foto, participantes,
convites e resposta bruta sao descartados. A rota oficial nao aplica um guard
explicito de conexao; timeout, rede, HTTP 400/401/403/404/5xx ou resposta
malformada interrompem a sincronizacao com erro sanitizado.

O identificador externo e validado como um JID de grupo opaco da 2.3.7. A
normalizacao remove somente espacos externos e preserva `@g.us`; ela nunca usa a
normalizacao de telefone. API, dashboard e logs recebem apenas um fingerprint
SHA-256 no formato `grp_...`, nunca o identificador completo.

`POST /whatsapp/groups/sync` cria grupos novos com `active=false`, atualiza
somente nome/contagem/metadados seguros e preserva autorizacao enquanto o grupo
continua disponivel. Um grupo ausente da consulta nao e apagado: fica
`available=false` e `active=false`. Os endpoints publicos sao:

- `POST /whatsapp/groups/sync`;
- `GET /whatsapp/groups`, com filtros opcionais `active` e `available`;
- `GET /whatsapp/groups/:id`;
- `PATCH /whatsapp/groups/:id`, aceitando somente `active`. Ativacao exige
  `confirm: "AUTORIZAR_GRUPO"`; desativacao e direta e grupo indisponivel nao
  pode ser ativado.

Nao existe endpoint de envio para grupos. O pipeline consulta somente destinos
`INDIVIDUAL`, portanto grupos autorizados nao geram fanout automatico e o
Scheduler continua enfileirando apenas `pipeline-product` sem grupos.

O Sender distingue os dois tipos. Telefones continuam protegidos pela allowlist
existente. Um grupo so pode chegar ao HTTP quando esta descoberto na instancia
atual, disponivel, ativo, com identidade exata, safe mode ativo e o master switch
`WHATSAPP_GROUP_SEND_ENABLED=true`. O padrao permanece `false`, e
`WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN=1` limita o processo. O dashboard altera
somente `active` no banco e nunca edita variaveis de ambiente.

O comando abaixo e dry-run por padrao:

```bash
corepack pnpm whatsapp:group-test
```

Ele valida Evolution 2.3.7, instancia open, banco, Redis, diretorio remoto e
autorizacoes persistidas sem escrever produto, copy, dispatch ou job, sem
iniciar worker e sem enviar. A saida inclui somente contagem e, quando existe um
unico grupo ativo/disponivel, nome e fingerprint. Master switch desligado e um
estado valido de preparacao com `readyForRealSend=false`.

Existe apenas para uma task futura o caminho exato abaixo, implementado e
coberto exclusivamente por mocks nesta sprint:

```bash
corepack pnpm whatsapp:group-test -- --confirm-one-real-group-message
```

Nao o execute sem uma autorizacao futura separada. Ele e bloqueado em CI, exige
exatamente um grupo ativo/disponivel, safe mode, master switch, limite 1 e
Scheduler desligado. Usa mensagem fixa, IDs tecnicos, um dispatch/job com
`attempts: 1`, sem backoff/retry/remocao, worker isolado e bloqueio permanente
depois de qualquer execucao anterior. Nao aceita ID, nome ou mensagem por
argumento.

A migracao `20260724190000_whatsapp_group_directory` atualiza com sucesso o
banco existente. A recriacao limpa continua bloqueada por uma limitacao anterior:
a primeira migracao versionada cria dispatches antes das tabelas historicas
`ProductLead` e `GeneratedCopy`. O primeiro erro reproduzido e Prisma `P3018`,
PostgreSQL `42P01`, `relation "ProductLead" does not exist`, ao aplicar
`20260724000000_whatsapp_dispatch`. Nenhuma migracao anterior foi alterada ou
re-baselineada nesta task.

### Débito técnico

- Adicionar autenticação/autorização antes de uso em produção.
- Criar painel operacional para reprocessar dispatches com falha.
- Validar o envio Evolution em ambiente controlado antes de habilitar produção.
- Produtos pontuados continuam sem metrica agregada no contrato atual.
- Fortalecer validação de status/filtros com schemas formais.

## Analytics

`GET /analytics` retorna um snapshot das metricas calculadas sobre os dados ja
persistidos:

- `totalProducts`
- `totalApprovedProducts`
- `totalGeneratedCopies`
- `totalQueuedDispatches`
- `totalSentDispatches`
- `totalFailedDispatches`
- `totalActiveDestinations`

O endpoint nao usa cache e nao calcula metricas na rota. A visao geral do
dashboard consome esse contrato pela camada centralizada de API e mostra as sete
metricas reais. Os dados refletem o estado persistido no momento da consulta.
Produtos pontuados nao sao exibidos porque esse campo nao existe em
`AnalyticsSnapshot`.

Loading, erro e retry de Analytics ficam isolados do restante da pagina. Depois
que um pipeline concluir, o botao `Atualizar metricas` faz uma nova consulta
explicita, sem polling permanente ou cache.

## Dashboard operacional 2.0

O dashboard em `apps/dashboard` e a interface principal da operacao diaria. Ele
usa Next.js App Router, uma camada de API centralizada e um proxy same-origin
autenticado no servidor. O navegador nao acessa Prisma, Redis, BullMQ ou
segredos diretamente.

A navegacao principal e composta por:

- **Inicio**: estado da API, estado da automacao, ultimo e proximo envio,
  atividade recente e a jornada do dispatch quando houver dados.
- **Ofertas**: catalogo paginado retornado por `GET /shopee/offers`, busca e
  filtros. Ações de sincronização, importação manual, detalhe e preview não
  são declaradas como fluxo operacional garantido aqui enquanto suas rotas não
  estiverem integralmente autorizadas pelo proxy same-origin.
- **Grupos e WhatsApps**: diretorio e autorizacao de grupos, instancias,
  assignments e estados derivados de health, disponibilidade e blockers.
- **Automacao**: pausa direta e retomada confirmada com CAS, horario, intervalo, stagger,
  limites de mensagens e limites diarios de Shopee/OpenAI, previsao de agenda,
  uso do dia e blockers.
- **Historico**: envios registrados, status, tentativas e detalhes sanitizados.
- **Configuracoes**: saude local, fuso horario, atalhos para as areas
  operacionais e acesso ao diagnostico avancado.

As telas de **Cupons**, **Campanhas**, **Fila** e **Diagnostico avancado** sao
areas complementares. As rotas legadas continuam disponiveis quando necessario
para compatibilidade ou investigacao, mas nao substituem a navegacao principal
do Dashboard 2.0.

O controle de automacao e separado do lifecycle do sistema: iniciar a
topologia pelo supervisor nao remove a pausa persistida. A area Automacao e a
autoridade para pausar, retomar e editar as regras persistidas; o supervisor
continua sendo a autoridade para processos, filas e shutdown.

Limitacoes que permanecem contratuais:

- Nao ha endpoint de reprocessamento manual de dispatches; o dashboard nao
  inventa essa acao.
- O Diagnostico avancado e somente leitura e nao oferece recovery, envio ou
  alteracao de lifecycle.
- Campos que nao estao disponiveis nas APIs aparecem como indisponiveis, sem
  metricas ou dados inventados.

Seguranca:

- O proxy do dashboard valida um destino local e envia a autorizacao ao
  backend somente no processo do servidor.
- Nenhuma credencial e armazenada ou renderizada no navegador, em variaveis
  `NEXT_PUBLIC_*`, HTML ou links.
- O provider mock continua seguro por padrao; Evolution e demais providers
  externos dependem da configuracao e dos guardrails do worker.

## Pipeline comercial em dry-run

A Task 16.1 adiciona um fluxo comercial independente do pipeline legado. Ele
seleciona ofertas `MOCK`, `MANUAL` ou `OFFICIAL` persistidas, aplica a politica
versionada da origem, ranking deterministico, bloqueia produtos ja enviados ao
grupo, exige exatamente um grupo autorizado/disponivel e gera uma copy final
sem cupom e sem comissao publica.

```bash
corepack pnpm commercial:dry-run
corepack pnpm commercial:dry-run -- --source=mock --minimum-score=70 --campaign=teste-local
```

O comando acessa somente PostgreSQL e, no provider mock, sincroniza o catalogo
ficticio local. Ele nao inicia API, worker ou Scheduler, nao acessa Redis, nao
chama Evolution/Shopee e nao cria `WhatsAppDispatch` ou job. `source=official`
usa exclusivamente registros ja persistidos; flags de envio/confirmacao e
ambientes com Scheduler ou group send ativos sao bloqueados.

API:

- `POST /commercial-pipeline/dry-run` prepara e registra o preview;
- `GET /commercial-pipeline/runs` lista o historico sanitizado;
- `GET /commercial-pipeline/runs/:id` detalha uma execucao.

O dashboard possui a pagina `Pipeline comercial`, com filtros, produto e grupo
selecionados, motivos, rejeicoes, preview copiavel, `plannedSubIds` e historico.
O dry-run em si nunca exibe uma acao capaz de enviar. A migration
`20260725210000_commercial_pipeline_dry_run` cria o historico sem guardar JID,
telefone, segredos ou payloads externos. Consulte
[docs/shopee-affiliate.md](docs/shopee-affiliate.md).

## Pipeline comercial confirmado

Um dry-run `COMPLETED` pode ser confirmado uma unica vez pela rota separada:

```text
POST /commercial-pipeline/runs/:id/confirm
{ "confirmation": "CONFIRMAR_ENVIO_COMERCIAL" }
```

O dashboard apresenta a confirmacao em modal e remove a acao depois de qualquer
tentativa. O historico mostra status do dispatch, `attemptCount`, se um ID
externo foi registrado e se investigacao manual e obrigatoria, sem revelar o
valor externo ou o identificador do grupo.

O CLI real e estrito:

```powershell
corepack pnpm commercial:confirm -- --run-id=<id> --confirm-one-real-commercial-message
```

Ele e bloqueado em CI e exige Evolution, safe mode, exatamente um grupo,
master switch ligado somente no processo, limites iguais a 1, Scheduler
desligado e nenhum worker concorrente. O job usa `attempts: 1`, sem backoff,
retry ou remocao. O mesmo `dryRunId` determina copy, dispatch e job; qualquer
estado anterior bloqueia outra tentativa. A copy e exatamente o snapshot do
dry-run, sem cupom, comissao, score ou urgencia falsa.

A confirmacao persiste copy, dispatch `PENDING`, atualizacao do run e
`CommercialDispatchOutbox` `PENDING` em uma unica transacao. Depois do commit,
um publicador idempotente verifica o `jobId` deterministico: reconhece o job ja
existente ou o cria uma vez. Falha de enqueue sem comprovacao posterior fica
`AMBIGUOUS` e nunca recebe retry automatico.

Recuperacao e consulta seguras:

```powershell
corepack pnpm commercial:outbox:status
corepack pnpm commercial:outbox:reconcile -- --outbox-id=<id> --confirm-safe-publication
```

O reconcile exige modo `preview`, os dois Schedulers desligados e nenhum worker
de dispatch ativo; ele nao inicia consumer ou provider. A API expoe somente
`GET /commercial-automation/outbox` e
`GET /commercial-automation/outbox/:id`, com paginacao e dados sanitizados. Nao
existe endpoint de publicacao.

## Controles operacionais da automacao comercial

A politica persistida governa a autorizacao de novos trabalhos comerciais. A
area **Automacao** do dashboard mostra o estado atual, os limites, o uso do dia,
os horarios previstos e os blockers. O sistema pode estar online enquanto a
automacao permanece pausada; iniciar ou parar a topologia nao altera essa pausa.
Os defaults sao conservadores:

```env
COMMERCIAL_AUTOMATION_ENABLED=false
COMMERCIAL_TIMEZONE=America/Sao_Paulo
COMMERCIAL_ALLOWED_START_TIME=08:00
COMMERCIAL_ALLOWED_END_TIME=20:00
COMMERCIAL_DAILY_GLOBAL_LIMIT=1
COMMERCIAL_DAILY_GROUP_LIMIT=1
COMMERCIAL_MIN_INTERVAL_MINUTES=60
```

O estado persistido tambem nasce pausado. Retomar exige a frase exata
`RETOMAR_AUTOMACAO_COMERCIAL` e a versao observada pela tela; essa acao remove
apenas a pausa e nao envia mensagem diretamente. O Scheduler e os workers
continuam sujeitos a janela, quota, readiness, assignment e demais guardrails.

Endpoints:

- `GET /commercial-automation/status`: decisao, motivos, janela, limites,
  historico real `SENT` e proxima permissao calculavel;
- `PATCH /commercial-automation/settings`: pausa diretamente; a retomada exige
  a confirmacao exata e `expectedUpdatedAt` da leitura atual.
- `PATCH /commercial-automation/settings/schedule`: altera horario, intervalo e
  stagger com a revisao esperada;
- `PATCH /commercial-automation/settings/admin`: altera limites de mensagens e
  budgets diarios externos com confirmacao e a revisao esperada.

O dashboard mostra esse estado em **Automacao**, com pausa direta e retomada em
modal. A leitura protegida e as mutacoes passam pelo proxy oficial. O Scheduler
comercial usa `evaluateAutomationReadiness()` antes de qualquer sincronizacao,
geracao ou trabalho de envio.

A API faz bind em `127.0.0.1` por padrao por meio de `HOST`. Use outro host
somente por configuracao explicita de ambiente quando a exposicao for realmente
necessaria.

## Scheduler da automacao comercial

A Sprint 17.2 adiciona um Scheduler separado do pipeline legado. Seus defaults
seguros sao:

```env
COMMERCIAL_SCHEDULER_ENABLED=false
COMMERCIAL_SCHEDULER_CRON=0 9 * * *
COMMERCIAL_SCHEDULER_TIMEZONE=America/Sao_Paulo
COMMERCIAL_AUTOMATION_MODE=preview
COMMERCIAL_EXECUTION_LEASE_SECONDS=120
COMMERCIAL_EXECUTION_HEARTBEAT_SECONDS=30
```

Ele usa exclusivamente a fila `commercial-automation`, o job
`commercial-automation-tick` e o ID `scheduled-commercial-automation`. A fila
`product-pipeline`, o job `pipeline-product` e seu agendamento permanecem
inalterados. O worker comercial tem concorrencia 1; cada job tem uma tentativa,
sem backoff, retry ou remocao automatica. O bootstrap nao dispara um tick.

Cada tick passa pelos guardrails, sincroniza o catalogo uma vez e executa um
dry-run uma vez. Em `preview`, termina sem dispatch ou job de WhatsApp. Em
`send`, delega somente ao fluxo de confirmacao ja existente e a configuracao e
aceita apenas com Shopee `official`, Evolution, safe mode e master switch de
grupos, com o Scheduler legado desligado. `mock` e `manual` nunca enviam.

As execucoes ficam em `CommercialAutomationExecution`. A identidade BullMQ
deduplica o mesmo job, uma chave ativa impede ticks simultaneos e qualquer run
confirmado iniciado, final pendente ou dispatch comercial em processamento
bloqueia nova execucao.

Cada execucao `STARTED` nova recebe owner interno, heartbeat e lease na mesma
criacao. O heartbeat e renovado durante o tick, e apenas o mesmo owner com lease
valida pode continuar ou finalizar. Registros sem ownership/lease e leases
vencidas ficam stale, exigem recuperacao manual e aparecem separados de uma
execucao realmente ativa; `ownerId` nunca e exposto.

Para validar com seguranca:

```powershell
corepack pnpm commercial:automation:preview
```

O comando forca `preview` independentemente do modo configurado, exige os dois
Schedulers desligados e nao inicializa Evolution, dispatch, worker de WhatsApp
ou envio. Nao existe CLI de `send` para a automacao.

Endpoints somente leitura:

- `GET /commercial-automation/scheduler`;
- `GET /commercial-automation/executions?page=1&limit=20`;
- `GET /commercial-automation/executions/:id`.

Nao existe endpoint de uso diario para executar um tick ou assumir o lifecycle
do Scheduler. A agenda persistida pode ser editada na area **Automacao** com a
revisao esperada; registro, consumidores e shutdown do Scheduler continuam sob
autoridade do supervisor/worker.

Consulta e recuperacao manual conservadora:

```powershell
corepack pnpm commercial:execution:status
corepack pnpm commercial:execution:recover -- --execution-id=<id> --confirm-stale-recovery
```

O recovery exige modo `preview`, automacao desabilitada e pausada e ambos os
Schedulers desligados. Ele processa somente uma execucao stale por
compare-and-set, nao inicia worker/provider e nunca cria ou publica job. Outbox
`PENDING` permanece inalterado e exige `commercial:outbox:reconcile`; job
publicado comprovado finaliza a responsabilidade como `QUEUED`; evidencia
incerta permanece `AMBIGUOUS`.

## Operacao local com um comando

O supervisor local inicia somente a topologia atual e explicita do projeto. Ele
nao executa `pnpm dev`, nao compoe o worker do pipeline legado e nao dispara
tick, dry-run, confirmacao, dispatch ou mensagem durante o bootstrap.

```powershell
corepack pnpm system:start
corepack pnpm system:status
corepack pnpm system:status -- --json
corepack pnpm system:logs
corepack pnpm system:logs -- --service=supervisor --lines=50
corepack pnpm system:stop
```

`system:start` carrega o `.env` ignorado da raiz e aplica variaveis do processo
por cima, somente em memoria. Ele valida Node, Corepack, Docker e arquivos
obrigatorios; inicia os dois composes; aguarda PostgreSQL, Redis e Evolution;
executa `prisma generate` e `prisma migrate deploy`; e sobe API, dashboard e o
worker comercial. O consumer isolado de `whatsapp-dispatch` e iniciado somente
quando `COMMERCIAL_AUTOMATION_MODE=send`. Esse consumer reutiliza o provider, a
politica de grupos e a finalizacao comercial existentes, sem Scheduler, Hunter,
Score, Copy ou `PipelineService` legado.
O comando so retorna sucesso depois de uma leitura final com topologia
`running`; se um filho morrer entre a verificacao inicial e esse snapshot, a
tentativa falha e reverte apenas os filhos que acabou de criar.

O estado sanitizado e os logs locais ficam em `.runtime/local-system/`, que e
ignorado pelo Git. O estado guarda somente versao, horario, modo, portas, nomes
logicos, PIDs e caminhos relativos de log. PIDs sao validados por identidade e
horario antes de qualquer encerramento. `system:stop` para apenas processos
registrados e confirmados, usa `docker compose stop` e preserva containers,
volumes, dados e agendamentos BullMQ.

`system:start` e `system:stop` sao mutuamente exclusivos por um lock JSON local
com owner token aleatorio, PID, marcador conhecido e horario real de inicio do
processo. PID sozinho nunca comprova ownership. Processo ausente ou PID
reutilizado torna o lock stale e permite recovery por releitura + reivindicacao
atomica por hard link, sem encerrar o ocupante; formato invalido/legado ou
identidade indisponivel preserva o arquivo para investigacao. A liberacao
compara token, PID e inicio, e por isso uma operacao antiga nao apaga o lock
sucessor.

No perfil operacional, o supervisor usa explicitamente o projeto Docker
`afiliado-shopee`; portanto o volume `afiliado-shopee_postgres_data` nao muda
quando o comando e acionado a partir de outra worktree. `system:status` informa
essa identidade e o volume PostgreSQL montado sem credenciais. Ambientes
isolados devem fornecer deliberadamente outro `--compose-project-name` ao
comando do supervisor.

`system:status` apenas classifica o lock como `unlocked`, `active`, `stale`,
`invalid` ou `unavailable` e nunca mostra o token.

Defaults continuam conservadores: iniciar o sistema nao habilita automacao ou
Schedulers, nao remove pausa persistida e nao cria trabalho. Para uma validacao
local inequivocamente segura, aplique somente ao processo:

```powershell
$env:COMMERCIAL_AUTOMATION_MODE='preview'
$env:COMMERCIAL_SCHEDULER_ENABLED='false'
$env:COMMERCIAL_AUTOMATION_ENABLED='false'
$env:SCHEDULER_ENABLED='false'
corepack pnpm system:start
```

Se o Docker daemon estiver desligado, o comando falha com
`DOCKER_DAEMON_UNAVAILABLE` e pede a inicializacao manual do Docker Desktop. Se
uma porta da API ou do dashboard estiver ocupada por outro processo, o
supervisor informa `SYSTEM_PORT_OCCUPIED` e nao encerra o ocupante. Em uma
parada com PID divergente ou recurso que nao encerrou, o estado e preservado e
a intervencao manual necessaria e reportada.

### Validação operacional prolongada em preview

Com o sistema inicialmente parado, lock livre, automação pausada e histórico
comercial sem estados pendentes ou ambíguos:

```powershell
corepack pnpm system:stability:preview -- --confirm-local-preview-stability-test
```

As configurações de teste existem somente nos processos filhos: Scheduler
legado e envio para grupos permanecem desligados, o modo é `preview` e a Shopee
usa o provider mock. A CLI exige um único grupo já autorizado e usa a instância
persistida apenas nos processos filhos, sem alterar grupo ou `.env`. Ela observa
ticks reais, reinicia somente processos
gerenciados, interrompe Redis/PostgreSQL com `compose stop/start` e preserva
todos os volumes. Em sucesso ou falha, pausa novamente a automação, remove o
Scheduler comercial conhecido e deixa a topologia parada. O relatório
sanitizado é salvo em
`.runtime/local-system/preview-stability-report.json`.

## Nichos e campanhas comerciais

A API oferece CRUD paginado em `/commercial/niches` e
`/commercial/campaigns`. Nichos normalizam categorias e keywords e fazem
matching determinístico de ofertas `OFFICIAL` por tokens/frases e critérios
comerciais.

Campanhas usam como identidade o fingerprint lógico do grupo, calculado apenas
do JID canônico e estável entre instâncias Evolution. O destino âncora é uma
referência interna, não a propriedade da campanha por um número específico.
Elas nascem inativas; a ativação exige `ATIVAR_CAMPANHA`, nicho ativo e destino
correspondente elegível.

A janela é `[allowedStartTime, allowedEndTime)` e os slots são
`floor((fimEmMinutos - inicioEmMinutos) / cadenceMinutes)`. IA, sender
assignments, dispatches e envio não fazem parte desta etapa.

## Mineração de promoções por campanha

A fila de candidatos é local e persistida em `CommercialPromotionCandidate`.
Ela avalia somente produtos `OFFICIAL` já sincronizados, valida o snapshot atual,
aplica o matcher do nicho e o score `official-v2`, detecta sinais promocionais e
materializa o top N definido por `queueTargetSize`. Não há consulta à Shopee,
Redis, BullMQ, Scheduler, copy, dispatch ou envio.

Desconto corrente não prova queda histórica: `PRICE_DROP` e
`DISCOUNT_INCREASE` comparam snapshots consecutivos, enquanto `NEWLY_OBSERVED`
significa observado pelo sistema nas últimas 24 horas. Os sinais não adicionam
pontos ao `official-v2`. `protectedCount` reduz a capacidade e força rebalanço;
avaliação truncada nunca é materializada. Cadência de 15 minutos ainda não cria
Scheduler; múltiplos remetentes continuam fora desta etapa, e candidatos
`QUEUED` seguem para a camada validada de copy abaixo.

Rotas disponíveis:

- `POST /commercial/campaigns/:id/mining-preview`: avaliação somente leitura;
- `POST /commercial/campaigns/:id/mine`: exige
  `{ "confirm": "MINERAR_PROMOCOES" }`;
- `GET /commercial/campaigns/:id/queue?page=1&limit=20`: fila paginada e
  sanitizada, com filtro opcional `status`.

Comandos locais:

```powershell
corepack pnpm commercial:campaign:preview -- --campaign-id=<id>
corepack pnpm commercial:campaign:mine -- --campaign-id=<id> --confirm-local-promotion-mining
```

O comando de escrita é bloqueado em CI e exige modo `preview`, automação
desabilitada e pausada, ambos os Schedulers desligados, group send desligado e
zero worker de dispatch. A materialização é idempotente por campanha + produto,
preserva `COPY_READY`/`RESERVED`, exclui `DISPATCHED` enquanto o dedupe está
ativo, bloqueia envios `SENT` recentes ao mesmo grupo lógico e não faz retry em
conflito concorrente.

## Copy promocional validada por IA

A geração para candidatos comerciais é separada do Copy Engine legado. Ela
vincula o input ao snapshot atual, reutiliza cache por fingerprint, adquire um
claim único e só altera o candidato para `COPY_READY` quando a copy AI validada,
a tentativa e o vínculo forem persistidos atomicamente. A IA gera apenas texto
estruturado; preço, desconto, sinal promocional e link são inseridos pelo
sistema, e respostas públicas substituem o link por `[LINK_AFILIADO]`.

Configuração local, sem incluir valores reais:

```env
OPENAI_API_KEY=
COMMERCIAL_AI_COPY_ENABLED=false
COMMERCIAL_AI_COPY_PROVIDER=openai
COMMERCIAL_AI_COPY_MODEL=
COMMERCIAL_AI_COPY_TIMEOUT_MS=30000
COMMERCIAL_AI_COPY_MAX_OUTPUT_TOKENS=1000
COMMERCIAL_AI_COPY_REASONING_EFFORT=minimal
```

A chave e o modelo ficam somente no `.env` ignorado; modelo e chave são
obrigatórios apenas quando a feature está habilitada. Credenciais não são
aceitas por argumento, log ou resposta.

```powershell
corepack pnpm commercial:copy:preflight
corepack pnpm commercial:copy:preview -- --candidate-id=<id>
corepack pnpm commercial:copy:generate -- --candidate-id=<id> --confirm-one-ai-copy
corepack pnpm commercial:copy:attempt:status -- --candidate-id=<id>
```

Preflight e preview não chamam IA nem escrevem. A geração manual exige banco
local, execução fora de CI, modo preview, automação pausada e desabilitada, os
dois Schedulers e group send desligados e zero worker de dispatch.

O orçamento padrão de `max_output_tokens` é 1000 (faixa aceita: 100–4000) e
inclui tokens de raciocínio. `COMMERCIAL_AI_COPY_REASONING_EFFORT` é validado
por enum e usa `minimal` por padrão. Respostas `incomplete` são falhas
terminais: `max_output_tokens` vira
`COMMERCIAL_AI_COPY_OUTPUT_TOKEN_LIMIT`, `content_filter` vira
`COMMERCIAL_AI_COPY_CONTENT_FILTERED` e outras razões permanecem em
`COMMERCIAL_AI_COPY_PROVIDER_INCOMPLETE`. O attempt registra somente usage
sanitizado e nunca persiste saída parcial.

Rotas disponíveis:

- `POST /commercial/promotion-candidates/:id/copy-preview`, sem campos no body;
- `POST /commercial/promotion-candidates/:id/copy-generate`, com
  `{ "confirm": "GERAR_COPY_COM_IA" }`;
- `GET /commercial/promotion-candidates/:id/copy`.

O prompt `commercial-promotion-copy-v2` trata catálogo como dado não confiável.
O schema remoto Structured Outputs é a versão v2 conservadora: objeto estrito
com propriedades obrigatórias, `additionalProperties: false`, strings, array
de strings e `maxItems`; limites de comprimento e unicidade permanecem somente
no validador local. Assim, a validação `commercial-promotion-copy-validation-v2`
continua rejeitando números, URLs, contatos, alegações não demonstradas,
comprimentos fora da política e hashtags duplicadas. O fingerprint não guarda
o link bruto; v1 e v2 produzem fingerprints distintos, preservando tentativas
antigas sem reutilizar cache entre versões. Claims `STARTED`, `FAILED` e
`AMBIGUOUS` impedem nova chamada para o mesmo input; `SUCCEEDED` reutiliza a
copy, sem retry automático.

O diagnóstico terminal do provider é persistido apenas em campos sanitizados
(status HTTP e códigos/tipo/parâmetro permitidos), mantendo `failureCode` como
classificação pública. Para consulta somente leitura, o CLI de status retorna
apenas identificadores internos, estado, classificação, provider/modelo
normalizados, versões, metadados sanitizados e timestamps; não exibe prompt,
output, fingerprint, produto, link ou credenciais.

Nenhuma chamada real à OpenAI foi executada nesta task. Scheduler de geração,
envio, WhatsApp, Evolution e múltiplos números permanecem fora desta Sprint.
