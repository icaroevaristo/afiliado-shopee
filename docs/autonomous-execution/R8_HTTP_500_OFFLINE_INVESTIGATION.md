# R8: investigação offline do SEND HTTP 500

Run: `R8-CONTROLLED-LIVE-SEND-CLOSEOUT-20260910-01`.
Baseline do envio: `06f3a25218bcd9399e680ba97c83065da13eaebd`, tree
`11ee8a09f523b9fd01bbed5c90609475e143c086`.

Em 2026-09-10, o único request SEND começou às `09:12:25.761Z` e recebeu
HTTP 500 às `09:12:26.234Z`. O ledger acumulado contém quatro requests Evolution,
dos quais um é SEND. A autorização está consumida. O relato do owner de que a
mensagem não apareceu não prova non-delivery.

## Imagem e contrato efetivamente executados

A análise usa o `dist/main.js` da imagem local `evoapicloud/evolution-api:v2.3.7`,
image ID `sha256:1bd8afc4a6cf48822e6cf02469aeae7bd35a12a6b616eacd1291926307f4d339`.
SHA256 do arquivo: `71b49ea87b8d0d7b413b77d067e33a8720c2e95e136f632210c1424862ef6b44`.
A instância persistida usa `WHATSAPP-BAILEYS`.

A URL vinculada no payload tem host `cf.shopee.com.br`, não possui extensão,
query ou fragmento. `mime-types` 2.1.35 retorna `false` para essa URL. Seu SHA256 é
`e70df44ff0b236ff02f2d0e7f5290ad5706036077d04d3bfca16706864e90ca6`.
A URL completa não é publicada.

O builder, sem alteração, reconstrói JSON com `number`, `mediatype`, `media` e
`caption`, para POST `/message/sendMedia/afiliado-shopee-local`, com
`Content-Type: application/json`. `mimetype` e `fileName` estão ausentes.
O schema da imagem exige `number` e `mediatype`; o controller aceita mídia URL
ou base64, além do upload opcional. JSON é aceito. A reconstrução confere com o
hash de mensagem autorizado; não equivale a recuperar um wire capture inexistente.

No caminho Baileys IMAGE, a ordem real é:

1. GET da mídia com Axios;
2. conversão Sharp para JPEG;
3. definição de `image.jpg` e `image/jpeg`;
4. `prepareWAMessageMedia`, com `client.waUploadToServer`;
5. resolução MIME por `fileName` e montagem da mensagem;
6. `sendMessageWithTyping`.

O lookup direto da URL observado em outras implementações da imagem não é o
caminho da instância vinculada. Um teste offline do método extraído, com I/O
substituído por doubles, aceita a URL sem extensão e produz JPEG. Falhas
injetadas no download, conversão e upload produzem o mesmo HTTP 500. Portanto,
adicionar `mimetype` ou `fileName` ao nosso payload não tem causa demonstrada.
O upload WhatsApp pode começar antes do término de `prepareMediaMessage`;
HTTP 500 sozinho não localiza o boundary da falha.

## Persistência e limites da evidência

Os cinco volumes originais e 283 arquivos de evidência foram preservados antes
da investigação. PostgreSQL e Redis foram consultados somente em cópias, com
`network=none`, sem portas publicadas ou processo Evolution. As consultas SQL
usaram transações READ ONLY. Nenhum volume original foi iniciado ou escrito.

A cópia Evolution contém zero Message, MessageUpdate, Chat e Media, inclusive
na janela do SEND. Entretanto, as flags de persistência de mensagens, updates,
chats e histórico estavam desativadas: ausência de registros não comprova ausência
de transporte. A instância registra `connectionStatus=open`, com `updatedAt`
`09:12:28.379Z`, posterior ao HTTP 500. Isso não comprova readiness às
`09:12:25Z`. O disconnection code 401 existente é de agosto e não prova a causa
desta tentativa. Há sessão persistida, sem prova offline suficiente de readiness.

O container temporário foi removido na etapa anterior. Seu response body e logs
brutos não foram preservados. Não foram reconstruídos. O erro P1017 posterior
foi consequência do encerramento deliberado do observador e não causou o HTTP 500.

## Correção comprovada no provider

Antes desta alteração, non-2xx era mapeado sem diagnóstico do body. Dois testes
causais falham no provider da baseline e passam com a correção. O novo leitor
tem limite de 2048 bytes e 100 ms, cancela a leitura e retorna somente formato,
classificação de enum e nomes conhecidos de campos. Nenhum texto externo, URL,
telefone, token, chave, stack ou payload é logado. Não é um sanitizador universal:
o texto externo é descartado, não liberado por uma blacklist.

A classificação serve apenas para diagnóstico. O HTTP error original é
preservado mesmo se a leitura do diagnóstico expirar. `deliveryMayHaveStarted`,
guard, payload, número de requests e política de zero retry não mudam. Esta
correção não recupera o diagnóstico perdido do envio histórico.

## Gates e classificação

Pelo `GATE_MATRIX.md`, R8-001 mede autorização: a linha exata, validade,
bindings e orçamento foram satisfeitos, portanto R8-001 = PASS. R8-002 e
R8-003 permanecem HUMAN_REQUIRED pela ambiguidade. A fase live não está aprovada.

```text
HTTP_500_ROOT_CAUSE=UNRESOLVED
FAILURE_LAYER=UNRESOLVED
PROVEN_NON_DELIVERY=false
POSSIBLE_EXTERNAL_EFFECT=true
PRIOR_AUTHORIZATION_CONSUMED=true
PRIOR_SEND_COUNT=1
AUTOMATIC_RETRY_COUNT=0
SECOND_SEND_COUNT=0
NEW_EVOLUTION_HTTP_REQUESTS=0
NEW_WHATSAPP_SEND_REQUESTS=0
RETRY_ALLOWED=false
DAILY_USE_READY=false
R9_STARTED=false
```

Uma futura probe READ ONLY de `GET /instance/connectionState/afiliado-shopee-local`
poderia medir apenas a conexão atual, com orçamento mínimo de um request
Evolution; iniciar a instância pode conectar a sessão WhatsApp. Exige autorização
separada e não provaria a causa histórica ou non-delivery. Nenhuma nova probe ou
SEND foi executado nesta investigação. O lifecycle ambíguo e seus locks permanecem
preservados. R9 e ativação diária continuam fora do escopo.
