# Fundação Shopee Affiliate Open API

Esta fundação prepara ofertas, importação manual, cupons e preview de copy.
Scraping, endpoints privados/mobile e qualquer tentativa de contornar
autenticação são proibidos. A captura documental local da Sprint 18.1 limita a
automação aos dois hosts oficiais, usa perfil efêmero e persiste somente
evidência sanitizada em diretório ignorado pelo Git.

## Evidência oficial pública

Em 28 de julho de 2026, o
[Explorer oficial V2](https://open-api.affiliate.shopee.com.br/explorer/v2) e a
[documentação oficial do programa](https://affiliate.shopee.com.br/open_api/document?type=overview)
foram renderizados nos hosts oficiais. O Explorer confirma a consulta
`productOfferV2` com estes campos:

- `nodes`: `productName`, `itemId`, `commissionRate`, `commission`, `price`,
  `sales`, `imageUrl`, `shopName`, `productLink`, `offerLink`,
  `periodStartTime`, `periodEndTime`, `priceMin`, `priceMax`, `productCatIds`,
  `ratingStar`, `priceDiscountRate`, `shopId`, `shopType`,
  `sellerCommissionRate` e `shopeeCommissionRate`;
- `pageInfo`: `page`, `limit`, `hasNextPage` e `scrollId`.

O contrato de
[requisição e resposta](https://affiliate.shopee.com.br/open_api/document?type=request_response)
confirma `POST https://open-api.affiliate.shopee.com.br/graphql`, body JSON com
`query`, `operationName` opcional e `variables` opcionais, e envelope GraphQL
`data`/`errors`, inclusive quando o HTTP é 200. O content type é
`application/json`.

A página oficial de
[autenticação](https://affiliate.shopee.com.br/open_api/document?type=authentication)
confirma o header:

```text
Authorization: SHA256 Credential=<AppId>, Timestamp=<Unix-seconds>, Signature=<sha256-hex-lowercase>
```

O material assinado, sem separadores adicionais, é `AppId + Timestamp + body
JSON exato + Secret`. O timestamp usa segundos Unix e pode diferir no máximo
dez minutos do servidor. A fixture pública oficial foi reproduzida em teste
determinístico; seus valores demonstrativos não são configuração local.

O limite documentado é 8.000 chamadas por hora. `scrollId` é de uso único,
expira em 30 segundos e deve ser usado na página seguinte; uma nova consulta
sem cursor deve respeitar intervalo superior a 30 segundos. O limite oficial
por página é 500, mas o comando controlado desta sprint fixa uma página e no
máximo cinco produtos, concurrency 1 e nenhum retry.

O Explorer descreve dinheiro como string na moeda local e taxas como razão
decimal (`0.0123` representa `1.23%`). A unidade de `periodStartTime` e
`periodEndTime` ainda precisa ser confirmada pela única resposta real
sanitizada; ela não é deduzida da nomenclatura. A documentação observada não
define restrições adicionais para o formato do App ID além do identificador
fornecido pelo portal, nem confirmou endpoint de cupons nesta sprint.

## Arquitetura

`ShopeeAffiliateOfferProvider` é independente de HTTP e Prisma e expõe
`listProductOffers(input)`. O contrato interno não replica argumentos GraphQL e
usa strings decimais para dinheiro. Percentuais e contagens continuam
numéricos.

Providers disponíveis:

- `MockShopeeAffiliateOfferProvider`: padrão, determinístico, somente dados e
  URLs `example.invalid`, com filtros e paginação local; nunca acessa internet.
- `ManualShopeeAffiliateOfferProvider`: valida JSON/CSV local, exige link
  afiliado explícito e nunca consulta ou completa uma página de produto.
- `OfficialShopeeAffiliateOfferProvider`: signer SHA-256 puro, clock e `fetch`
  injetáveis, timeout/abort, limite de resposta e erros públicos sanitizados.
  Sem configuração retorna `SHOPEE_API_NOT_CONFIGURED`; a URL aceita é apenas o
  endpoint oficial confirmado.

`ShopeeOfferSyncService` consulta no máximo
`SHOPEE_AFFILIATE_SYNC_LIMIT` registros por execução, valida, ignora expirados,
deduplica por `source + providerProductId` e cria ou atualiza o mesmo
`ProductLead`. Ele não chama Copy, Pipeline, BullMQ, Scheduler ou WhatsApp.

## Configuração

```env
SHOPEE_AFFILIATE_PROVIDER=mock
SHOPEE_AFFILIATE_API_ENABLED=false
SHOPEE_AFFILIATE_APP_ID=
SHOPEE_AFFILIATE_SECRET=
SHOPEE_AFFILIATE_API_URL=
SHOPEE_AFFILIATE_SUB_ID_PREFIX=whatsapp
SHOPEE_AFFILIATE_SYNC_LIMIT=20
```

Valores de provider: `mock`, `manual` e `official`. `official` exige enabled,
URL oficial exata, App ID e Secret; nenhum desses valores é aceito por endpoint
público ou renderizado no dashboard. `shopee:official:configure` grava somente
o `.env` raiz ignorado, por entrada local oculta e escrita atômica.

Comandos operacionais da Sprint 18.1:

```powershell
corepack pnpm shopee:official:capture-contract
corepack pnpm shopee:official:configure
corepack pnpm shopee:official:preflight
corepack pnpm shopee:official:sync -- --confirm-one-real-read
corepack pnpm shopee:official:sync -- --confirm-second-real-read-after-fix
corepack pnpm shopee:official:sync -- --confirm-final-real-read-after-auth-fix
corepack pnpm shopee:official:sync -- --confirm-mapping-fix-real-read
```

As quatro flags de sync registram autorizações históricas de uso único. Seus
marcadores já existentes impedem reexecução; o bloco não é um roteiro para
repetir chamadas consumidas.

O capture usa perfil efêmero, não salva screenshots, HAR, storage, cookies ou
headers brutos e bloqueia POST GraphQL antes da rede. O preflight não lista
produtos e exige preview, ambos os Schedulers desligados, automação desabilitada
e pausada, envio em grupo desligado e nenhum worker/job ativo de dispatch. O
sync mantém um marcador local ignorado antes do único request, limita a cinco
itens e compara contagens comerciais antes/depois.

A segunda flag foi uma autorização diagnóstica única após a primeira resposta
HTTP 200 ter sido registrada sem o detalhe público do erro GraphQL. Ela exige o
marcador anterior com `SHOPEE_API_GRAPHQL_ERROR`, zero produto `OFFICIAL` e cria
um marcador separado antes da rede; sua existência bloqueia permanentemente
outra leitura nesta sprint. A evidência sanitizada observada em 29 de julho de
2026 foi HTTP 200, código público `10020` e mensagem `Invalid Credential`, sem
`data` ou nodes. Portanto, a falha foi classificada como autenticação, não como
query, variables, permissão ou rate limit. Naquele checkpoint, nenhuma alteração
de signer/query era justificada e nenhuma terceira chamada havia sido feita.

A autorização final exige o marcador preservado da segunda tentativa com HTTP
200 e erro `10020`, zero produto `OFFICIAL` e um novo marcador exclusivo antes
da rede. Ela foi adicionada somente depois de o Explorer oficial responder com
sucesso usando as credenciais reconfiguradas e de a comparação em memória
confirmar endpoint, método, content type, formato do header, Credential,
timestamp, serialização e assinatura. A assinatura do Explorer coincide com a
fórmula documentada; portanto, não houve alteração especulativa no signer.

Na validação observada em 29 de julho de 2026, o Explorer retornou um node com
`offerLink`, e a leitura terminal do provider retornou HTTP 200, sem erro
GraphQL, com cinco nodes e cinco `offerLink`. A resposta confirmou dinheiro e
taxas como strings, contagens e IDs como números, `periodStartTime` em segundos
e `scrollId` nulo. O mapeamento rejeitou os cinco nodes antes da persistência;
o limite antigo de ano 2100 rejeitou `periodEndTime` válido em seconds no ano 2999.

O parser corrigido aceita timestamps Unix em seconds ou milliseconds somente
quando exatamente uma unidade produz uma `Date` válida entre 2000 e 9999. Ele
rejeita data anterior, overflow, resultado inválido e ambiguidade, sem tratar
data distante como ausência de vencimento. A autorização terminal de
mapeamento exigiu a evidência sanitizada anterior, zero produto `OFFICIAL`,
preflight seguro e criou um quarto marcador antes de um único request. O
resultado foi cinco itens válidos e criados, zero rejeições, cinco links
afiliados presentes e `rejectionSummary` vazio.

## Importação manual

JSON aceita um objeto ou um array. O exemplo versionado em
`fixtures/shopee-manual-offer.example.json` é totalmente fictício. Campos
obrigatórios:

```json
{
  "providerProductId": "manual-001",
  "productName": "Produto de teste ficticio",
  "shopName": "Loja de teste ficticia",
  "categoryIds": ["categoria-ficticia"],
  "price": "99.90",
  "discountRate": 20,
  "rating": 4.8,
  "sales": 1000,
  "commissionRate": 8,
  "imageUrl": "https://example.invalid/image.jpg",
  "productLink": "https://example.invalid/product/manual-001",
  "affiliateLink": "https://example.invalid/affiliate/manual-001"
}
```

Para CSV, use esses nomes como cabeçalho; `categoryIds` usa `;` para separar
valores. Datas opcionais devem ser ISO 8601. URLs precisam usar HTTP/HTTPS e
`affiliateLink` deve ser obtido manualmente no portal/app. Um link comum nunca é
convertido automaticamente.

Dry-run, padrão e sem banco:

```powershell
corepack pnpm shopee:import -- --file fixtures/shopee-manual-offer.example.json
```

Persistência exige a flag exata:

```powershell
corepack pnpm shopee:import -- --file caminho.json --confirm-import
```

## API local

- `POST /shopee/offers/sync`: sincroniza o provider selecionado sem pipeline.
- `GET /shopee/offers`: paginação e filtros por texto, origem, status e presença
  de link afiliado.
- `GET /shopee/offers/:id`: detalhe público sem segredos.
- `POST /shopee/offers/import/validate`: valida e retorna preview; não grava.
- `POST /shopee/offers/import`: grava somente com
  `confirm: "CONFIRMAR_IMPORTACAO"`.
- `POST /shopee/offers/:id/copy-preview`: gera `PREVIEW — NAO ENVIADO`, sem
  persistir copy ou criar dispatch.
- `GET|POST|PATCH|DELETE /coupons`: CRUD manual; criação/alteração e exclusão
  exigem confirmações explícitas.

O dashboard Produtos consome essas rotas, e a página Cupons gerencia somente
registros locais confirmados.

## Persistência e score

`ProductLead` preserva seu ID e relações com copies/dispatches em atualizações.
Preço, faixas e valor de comissão usam `Decimal`; percentuais permanecem
numéricos. Produtos não são apagados automaticamente. `lastSeenAt` registra a
última observação e `unavailableAt` fica disponível para uma política futura
explícita.

### Snapshots comerciais OFFICIAL

O caminho `OFFICIAL` usa um upsert transacional exclusivo: `ProductLead`,
`commercialSnapshotRevision`, `commercialSnapshotFingerprint` e o eventual
`CommercialOfferSnapshot` são atualizados juntos. O fingerprint SHA-256
canônico inclui preço/faixa, desconto, comissão, início, término e
indisponibilidade. Ele não inclui rating, vendas, nomes, URLs, IDs ou horários
operacionais.

Revision representa uma mudança comercial, enquanto `fetchedAt` representa a
observação recebida. Assim, A → A mantém a revision atual e A → B → A cria três
revisions, preservando o retorno ao estado anterior. Rating e vendas são
registrados no snapshot quando uma revision é criada, mas alterações isoladas
nessas observações apenas atualizam o produto. `capturedAt` é sempre o
`fetchedAt` da oferta, inclusive no baseline.

Produtos `OFFICIAL` existentes na revision zero são inicializados em lotes de
até 100 pelo comando local explícito e idempotente:

```powershell
corepack pnpm commercial:snapshots:backfill -- --confirm-local-official-backfill
```

O backfill exige preview, automação pausada e desabilitada, os dois Schedulers
e group send desligados e zero worker de dispatch. Ele usa somente PostgreSQL
local, não altera dados comerciais e não chama Shopee, Redis, Evolution ou
WhatsApp. Mineração, sinais promocionais e filas permanecem fora desta task.

A fórmula `legacy-v1` permanece para `MOCK` e `MANUAL`:

- comissão: 35%, normalizada entre 0 e 20%;
- avaliação: 25%, normalizada entre 0 e 5;
- vendas: 20%, normalizada entre 0 e 10.000;
- desconto: 10%, normalizado entre 0 e 100%;
- loja oficial: 10%, conforme a regra textual preexistente.

Preço não recebeu peso arbitrário. Oferta expirada ou indisponível é
inelegível, e a listagem para score exclui esses registros. Não há métrica de
conversão inventada.

Produtos `OFFICIAL` persistidos usam a politica comercial `official-v2`:

- comissao limitada a 20%: ate 35 pontos;
- avaliacao limitada a 5: ate 25 pontos;
- vendas limitadas a 10.000 e normalizadas por `log10(1 + vendas)`: ate 20
  pontos;
- desconto limitado a 100%: ate 20 pontos.

A soma interna conserva precisao completa e somente o score final e
arredondado. Preco, `commissionAmount`, nome da loja, `shopType` e categoria nao
participam. O minimo padrao oficial e 60; o legado permanece 70, e um valor
explicito sempre prevalece.

O comando read-only abaixo aceita zero argumentos, exige o ambiente local
pausado em preview e nao compoe provider, fila ou pipeline run:

```powershell
corepack pnpm commercial:official:diagnose
```

O relatorio contem apenas IDs internos, rejeicoes estruturais, distribuicao e
componentes com ate quatro casas decimais. Ele e salvo em
`.runtime/local-system/official-offer-diagnosis.json`, ignorado pelo Git.

## Links, Sub_ids e cupons

Links manuais são preservados exatamente. Metadados planejados para Sub_ids
mantêm separadamente `channel`, fingerprint do grupo, campanha e data; o
utilitário não concatena parâmetros em URLs.

O modelo `Coupon` aceita origem `MANUAL` ou `OFFICIAL`, mas somente CRUD manual
está ativo. Cupom vencido, inativo ou com compra mínima não atendida é
inelegível. O sistema não calcula preço final quando falta o valor da compra,
não coleta cupons e não inclui cupom automaticamente na copy nesta task.

## Sprint 18.1

Contrato, signer, transporte, mapeamento, configuração e guardas operacionais
foram implementados com fixtures oficiais e HTTP mockado. Os marcadores das
duas tentativas com erro foram preservados. Depois da reconfiguração local, o
Explorer e as leituras terminais comprovaram autenticação válida sem alteração
do signer. O parser de timestamps preserva datas far-future válidas e a última
autorização persistiu cinco produtos oficiais com seus links exatos. Todos os
marcadores foram preservados e o marcador de mapping fix bloqueia repetição.
O dry-run comercial local com score mínimo 70 terminou em
`NO_ELIGIBLE_PRODUCT`, sem dispatch, outbox ou job. Cupons continuam fora do
escopo enquanto não houver endpoint oficial confirmado.

## Pipeline comercial dry-run — Task 16.1

`CommercialPipelineService` prepara uma unica oportunidade comercial sem chamar
o pipeline legado. O fluxo consulta o catalogo persistido, aplica filtros de
origem `MOCK`, `MANUAL` ou `OFFICIAL`, valida elegibilidade, resolve a politica
versionada da origem, ordena os candidatos e escolhe exatamente um grupo
ativo/disponivel da instancia atual. O servico depende somente de contratos e
nao importa Prisma, Fastify, BullMQ, Evolution ou WhatsApp.

Valores padrao: origem `MOCK`, score minimo 70 para `MOCK`/`MANUAL`, 60 para
`OFFICIAL` e no maximo 20 candidatos. O limite absoluto e 100. Produto sem link afiliado, expirado, indisponivel,
invalido ou abaixo do score minimo recebe motivo estruturado. Links devem ser
HTTP/HTTPS e nunca sao modificados.

O ranking e deterministico, nesta ordem:

1. maior score;
2. maior taxa de comissao;
3. maior numero de vendas;
4. maior desconto;
5. maior avaliacao;
6. `providerProductId` em ordem lexicografica.

Depois do ranking, `CommercialDeliveryHistoryRepository` descarta produtos que
ja tenham `WhatsAppDispatch` `SENT` para o grupo ou execucao futura `CONFIRMED`
concluida. Registros `DRY_RUN` nunca contam como envio e o historico nao e
apagado.

A selecao de destino aceita somente um registro `GROUP`, `active=true`,
`available=true`, da instancia atual e com fingerprint valido. Zero grupos
retorna `NO_AUTHORIZED_GROUP`; mais de um retorna
`MULTIPLE_AUTHORIZED_GROUPS`. O identificador externo nunca aparece no resultado
ou no historico.

A copy comercial usa somente nome, preco formatado em pt-BR, desconto opcional,
loja, CTA e o `affiliateLink` persistido. Ela nao usa cupom, comissao, score,
IDs tecnicos, alegacoes nao verificadas ou urgencia falsa. O limite padrao e
`COMMERCIAL_COPY_MAX_LENGTH=1000`.

Metadados de tracking reutilizam `buildShopeeAffiliateTrackingMetadata` e
`toPlannedShopeeSubIds`. Canal, fingerprint, campanha e data sao retornados em
`plannedSubIds`; nenhum parametro e concatenado ao link.

Cada tentativa valida cria um `CommercialPipelineRun` `DRY_RUN`. Estados
concluidos, bloqueados e falhos guardam apenas produto/grupo sanitizados, score,
contagens, resumo de rejeicoes, copy, Sub_ids planejados e codigo publico. Nao
sao armazenados JID, telefone, credencial, payload Evolution ou participantes.
A migration `20260729100000_official_offer_scoring_v2` adiciona versao da
politica, limite usado, maior score observado e breakdown selecionado. Runs
`BLOCKED` nao guardam breakdown individual de produtos rejeitados.

Rotas:

- `POST /commercial-pipeline/dry-run`;
- `GET /commercial-pipeline/runs`;
- `GET /commercial-pipeline/runs/:id`.

Comando local:

```powershell
corepack pnpm commercial:dry-run
corepack pnpm commercial:dry-run -- --source=mock --minimum-score=70 --campaign=teste-local
```

O CLI carrega o `.env` ignorado, acessa somente PostgreSQL, sincroniza dados
ficticios quando o provider e mock e bloqueia provider official, Scheduler ou
envio para grupos ativos. Flags de envio, confirmacao, grupo, mensagem, destino
ou cupom sao rejeitadas.

O resultado fixa `dispatchWillBeCreated=false`, `jobWillBeCreated=false` e
`messageWillBeSent=false`. Nao ha endpoint confirmado e nenhuma acao desta task
chama Shopee real, Evolution, Redis, worker ou fila.

## Pipeline comercial confirmado — Task 16.2

`POST /commercial-pipeline/runs/:id/confirm` confirma somente um dry-run
`COMPLETED` existente e aceita exclusivamente
`CONFIRMAR_ENVIO_COMERCIAL`. O proprio run muda para `CONFIRMED`; produto,
grupo, copy e Sub_ids permanecem os snapshots aprovados.

Antes do dispatch, o fluxo revalida a oferta `MOCK` ou `MANUAL`, o link, a copy,
o unico grupo autorizado da instancia, o historico de entrega, safe mode,
master switch, Scheduler desligado e limite de uma mensagem. Nenhum ranking e
executado e nenhum outro produto/grupo e escolhido.

Copy tecnica, dispatch e job possuem IDs deterministicos ligados ao `dryRunId`.
A reivindicacao atomica e a existencia de qualquer um desses registros bloqueiam
repeticao. O job `whatsapp-dispatch` tem uma tentativa, sem backoff ou remocao.
O worker existente finaliza o run; timeout, falha e ambiguidade nunca geram
retry e registram investigacao obrigatoria.

Comando controlado:

```powershell
corepack pnpm commercial:confirm -- --run-id=<id> --confirm-one-real-commercial-message
```

O comando carrega o `.env` ignorado sem imprimi-lo, bloqueia CI, provider Shopee
official, Scheduler, safe mode falso, master switch desligado, limites diferentes
de 1 e workers concorrentes. Ele inicia somente o consumer de dispatch. Cupons,
scraping, API oficial da Shopee, Hunter, Score, Copy legado, pipeline-product e
Scheduler continuam fora do fluxo.

## Nichos comerciais e campanhas por grupo lógico

Ofertas oficiais já persistidas podem ser avaliadas por `CommercialNiche` sem
nova consulta à Shopee. A correspondência normaliza acentos, caixa, pontuação e
espaços, usa sequência de tokens para palavras/frases, include `ANY`, exclusões
e critérios numéricos. Evidências não incluem nome completo, URL ou ID externo.

`CommercialGroupCampaign` usa o fingerprint do JID canônico como identidade
lógica estável entre instâncias Evolution. O destino âncora é apenas uma
referência interna atual. Cadência e janela determinam
`floor((fim - início) / cadenceMinutes)` slots, limitando o total diário.

O planner operacional cria somente a próxima slot pendente por alvo. A próxima
instância é a seguinte à última `SENT` confirmada no histórico do grupo; bloqueio,
falha pré-provider, ambiguidade e stale não avançam a rotação. Assim, uma falha
de B depois de um envio confirmado por A não permite um novo A por replan.

## Mineração local de promoções

`CommercialPromotionMiningService` percorre por cursor somente ofertas
`OFFICIAL` persistidas e compara o snapshot atual com o anterior quando existe.
O matcher do nicho e o score `official-v2` continuam sendo as únicas políticas
de elegibilidade e pontuação. Os sinais públicos são `PRICE_DROP`,
`DISCOUNT_INCREASE`, `NEWLY_OBSERVED` e `CURRENT_DISCOUNT`; dinheiro e queda
percentual são calculados com `Decimal`.

`CURRENT_DISCOUNT` indica apenas desconto corrente e não comprova queda
histórica. `PRICE_DROP` exige redução de preço entre os dois snapshots
consecutivos; `DISCOUNT_INCREASE` compara o percentual desses snapshots.
`NEWLY_OBSERVED` significa que produto e primeiro snapshot foram observados
pelo sistema nas últimas 24 horas, não que o item seja novo na Shopee. Revision,
fingerprint, produto e último snapshot precisam ser coerentes; divergência não é
corrigida automaticamente.

`official-v2` continua sendo somente o score de qualidade: sinais promocionais
não acrescentam pontos. O ranking ordena queda de preço, percentual da queda,
score, desconto, comissão, vendas e ID interno. O dedupe usa o fingerprint
lógico do grupo e, portanto, abrange envios feitos por números Evolution
diferentes.

O preview é somente leitura e pode relatar avaliação parcial quando o teto de
2.000 produtos é alcançado. A mineração confirmada bloqueia resultados
truncados e materializa até `queueTargetSize` candidatos na tabela
`CommercialPromotionCandidate`. A unique campanha + produto, o lock da campanha
e atualizações condicionais tornam repetições idempotentes e protegem
`COPY_READY`/`RESERVED`. `DISPATCHED` não ocupa capacidade ativa: dedupe futuro
e dispatch `SENT` recente para o mesmo fingerprint lógico impedem reentrada;
depois disso, um item novamente elegível pode voltar a `QUEUED`.

`protectedCount` reduz `queueTargetSize`; os `QUEUED` restantes são
rebalanceados e itens fora do novo top ficam `BLOCKED`. Um candidate sem imagem
ou link elegível, expirado/stale, ou com output de IA terminalmente rejeitado
também é descartado da capacidade útil com motivo preservado. A preparação pode
substituí-lo pelo próximo candidate do mesmo alvo, em número limitado; ela nunca
repete o mesmo contrato rejeitado.
Um blocker terminal de copy permanece `BLOCKED` para o mesmo snapshot/contrato e
não é reativado genericamente por nova materialização. Somente um snapshot novo
e legítimo permite reativação. Candidatos terminais são filtrados antes do corte
por `queueTargetSize`, então quatro ranks terminais não monopolizam uma fila de
capacidade 4 e um rank 5 válido pode ocupar a capacidade útil.
`evaluationTruncated=true` pode ser visto no preview, mas nunca materializado.
Uma campanha com cadência de 15 minutos ainda não possui Scheduler nesta etapa.
O uso de múltiplos remetentes continua fora desta etapa; candidatos `QUEUED`
podem seguir para a camada validada de copy descrita abaixo.

```powershell
corepack pnpm commercial:campaign:preview -- --campaign-id=<id>
corepack pnpm commercial:campaign:mine -- --campaign-id=<id> --confirm-local-promotion-mining
```

A escrita exige banco local, execução fora de CI, modo preview, automação
desabilitada e pausada, os dois Schedulers e o envio de grupo desligados e zero
worker de dispatch. As rotas equivalentes são `POST
/commercial/campaigns/:id/mining-preview`, `POST
/commercial/campaigns/:id/mine` com confirmação `MINERAR_PROMOCOES` e `GET
/commercial/campaigns/:id/queue`. Respostas não incluem URL, ID externo, JID,
telefone, segredo ou payload bruto. Nenhum desses caminhos chama Shopee,
Evolution ou WhatsApp e nenhum deles cria job, dispatch ou outbox.

## Copy validada para candidatos comerciais

Somente candidato `OFFICIAL/QUEUED`, com produto disponível, score elegível e
snapshot/revision/fingerprint ainda atuais, pode iniciar a geração. Produto,
loja e nicho são normalizados como dados não confiáveis; a IA recebe ainda
sinais, score, desconto, avaliação, vendas, queda opcional e limites, mas nunca
`affiliateLink`, `productLink`, `providerProductId`, `shopId`, fingerprint,
credencial ou identificador de mensageria.

O Structured Output estrito produz apenas headline, body, CTA e hashtags. A
validação impede que a IA gere ou repita números, preço, percentual, avaliação,
vendas, link, contato, markdown ou alegações promocionais não comprovadas. O
assembler insere deterministicamente nome e loja persistidos, preço em BRL,
desconto positivo, no máximo um sinal prioritário e exatamente o
`affiliateLink` atual. O link não é alterado, parametrizado, encurtado ou
truncado.

A `GeneratedCopy` AI fica vinculada ao snapshot exato e o candidato só então
passa a `COPY_READY`. Fingerprint canônico, cache e claim único impedem chamada
duplicada. `FAILED` preserva falha confirmada; `AMBIGUOUS` preserva incerteza;
nenhum deles recebe retry automático para o mesmo input.

Preflight e preview são read-only: não bloqueiam candidate, não reativam estado
terminal e não alteram persistência. A geração não consulta a Shopee, não altera
signer, query, matcher ou score, e não cria pipeline run, automation execution,
dispatch, outbox, job ou mensagem.

No runtime de automação, o reabastecimento é progressivo e limitado: fila local,
mineração do catálogo persistido e, somente se necessário, páginas `ProductOfferV2`.
Cada página respeita `hasNextPage`, cursor/página e os budgets do provider; não
há página adicional quando a capacidade local já resolve a slot. Falha de
provider, orçamento ou resultado ambíguo encerra o fluxo fail-closed e não é
convertida em fallback de candidate.

Cada fulfillment usa no máximo 3 páginas Shopee. Se a última página permitida
ainda tiver `hasNextPage=true`, o resultado explícito é
`COMMERCIAL_AUTOMATION_REPLENISHMENT_LIMIT_REACHED`; quando a fonte termina sem
candidate útil, o resultado é `COMMERCIAL_AUTOMATION_CATALOG_EXHAUSTED`. Uma
falha terminal específica do candidate pode continuar o fulfillment na mesma
slot, preservando target, campanha, grupo e instância e mantendo/renovando a
mesma reservation. O fluxo tenta novamente o catálogo persistido antes de
continuar da próxima página Shopee, sem reiniciar paginação ou budget. A rotação
round-robin de instâncias continua avançando somente após `SENT` confirmado;
assim, se B bloqueia depois de A ter sido `SENT`, B permanece o próximo alvo do
planner.


## Sync Operacional Paginado

O sync histórico e limitado a uma request, ate cinco produtos e tem finalidade diagnostica.

O sync operacional e desabilitado por padrao (`SHOPEE_OFFICIAL_CATALOG_SYNC_ENABLED=false`). A execucao exige o bloqueio de CI, execucao em banco local, preflight dinamico e confirmacao explicita:

```powershell
corepack pnpm shopee:official:catalog:preflight
corepack pnpm shopee:official:catalog:sync -- --confirm-local-official-catalog-sync
```

As configuracoes padrao de paginacao sao 20 itens por pagina e 3 paginas (20 × 3), e overrides na linha de comando nao superam a configuracao ou o maximo agregado configurado. O processamento realiza requests sequenciais com zero retry e e protegido por um lock PostgreSQL de sessao em conexao dedicada. Retornos PARTIAL e FAILED geram codigo de saida diferente de zero (exit code 1).
