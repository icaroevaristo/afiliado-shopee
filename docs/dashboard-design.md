# Shopee Operations Console

> **Documento histórico.** Este arquivo registra o design operacional anterior ao
> Dashboard 2.0 e não deve ser usado isoladamente como especificação da
> interface atual. Para o design vigente, consulte `apps/dashboard/DESIGN.md`.

## Conceito

Uma control room local para acompanhar a automacao comercial de afiliados.
O dashboard deve responder rapidamente a tres perguntas: a automacao esta
operando, qual foi o ultimo resultado e o que sera processado em seguida.
Ele e operacional e read-only por padrao; as unicas acoes de controle sao
pausar e retomar a automacao pelos endpoints oficiais.

## Personalidade

Precisa, tecnica, comercial e silenciosa. A interface privilegia informacao
persistida, estado atual e rastreabilidade de IDs. Nao usa linguagem de
marketing, metricas inventadas ou decoracao sem funcao.

## Layout

- Navegacao lateral compacta com Visao geral, Envios, Fila, Produtos,
  Campanhas e Automacao.
- Workspace central com largura controlada e ritmo vertical curto.
- Operations Strip no topo: automacao, proximo tick, ultimo envio, envios do
  dia, disponibilidade da API e estado do scheduler.
- Home em duas colunas: timeline de atividade e ultimo envio; abaixo, fila
  pronta e saude do sistema.
- Envios usa tabela operacional e drawer lateral de detalhes.
- Fila usa tabela com filtros de status, sem kanban.
- Campanhas e grupos sao somente leitura nesta versao.

## Tokens

```text
canvas          #0B0D10
surface         #111419
surfaceElevated #161A20
surfaceHover    #1B2027
border          #252B34
borderStrong    #343C48
textPrimary     #F4F6F8
textSecondary   #9AA4B2
textMuted       #66717F
accent          #EE4D2D
success         #48B88A
warning         #D6A34A
danger          #E66B6B
info            #6B9CDA
```

Laranja aparece em foco, item ativo e acao principal. Estados sao contidos e
nao dependem apenas de cor: badges tambem usam texto e icone.

## Tipografia e espaco

UI usa uma sans-serif do sistema; IDs, cron, horarios e logs usam
`ui-monospace`. Titulos sao firmes e compactos. Numeros operacionais usam
`font-variant-numeric: tabular-nums`. Escala de espaco parte de 4, 8, 12, 16,
24 e 32px.

## Estados

Toda tela trata loading, vazio, erro e stale/offline. Quando uma fonte falha,
os dados validos anteriores permanecem visiveis com horario da ultima
atualizacao. Um empty state informa o proximo passo sem criar dados ficticios.

## Tabelas e badges

Tabelas sao densas, com cabecalho persistente, linhas com hover discreto,
imagens dimensionadas e texto truncado com `title`. Status usa badges curtos:
SENT, FAILED, PROCESSING, PENDING, QUEUED, COPY_READY e DISPATCHED. Score tem
hierarquia numerica, nao velocimetro ou gradiente.

## Drawer e controles

Detalhes de envio abrem em drawer lateral, preservando o contexto da tabela.
IDs ficam em monospace e possuem botao de copiar com aria-label e tooltip.
Pausar e retomar usam dialog de confirmacao e somente os endpoints oficiais.
Nao existem controles para editar `.env`, cron, limites, retries ou envio
manual.

## Responsividade

Em desktop a navegacao fica fixa e o workspace usa duas colunas. Em tablet a
segunda coluna quebra abaixo da timeline. Em mobile a navegacao vira drawer,
operations strip vira lista horizontal com overflow controlado e tabelas
ganham rolagem horizontal sem reduzir texto a um tamanho ilegivel.

## Dados e polling

O frontend consome somente APIs existentes via `lib/api`. Status critico usa
polling de 15 segundos; listagens usam 30 segundos. Polling para quando a aba
fica oculta. Requests da mesma tela sao agrupados com `Promise.all` e nunca
existe fetch de banco, Redis, BullMQ ou provider comercial no browser.

## Padroes proibidos

- hero, slogan ou linguagem de marketing;
- grade de cards iguais e metricas inventadas;
- gradientes, glassmorphism, glow, blobs ou roxo neon;
- card dentro de card e radius exagerado;
- spinner infinito sem contexto;
- texto de placeholder em runtime;
- acao de SEND, retry, alteracao de configuracao ou multi-grupo;
- componentes que dependam somente de cor para comunicar estado.

## Assinatura visual: Affiliate Dispatch Control

A visao geral usa a cadeia operacional `Produto -> Candidato -> Copy ->
Dispatch -> Grupo -> Sent` como linguagem de produto. Ela aparece em tres
camadas complementares:

- a faixa superior e uma telemetria continua: LIVE, proximo disparo, ultimo
  dispatch, limite do dia, cadencia e saude da API;
- o Dispatch Rail conecta os estagios do ultimo envio e usa ponto preenchido,
  ponto vazado ou marcacao critica para distinguir concluido, aguardando e
  bloqueado;
- o Dispatch Receipt concentra produto, preco, copy disponivel, rota,
  tentativa, provider e IDs persistidos sem inventar dados ausentes.

A fila pronta e uma fila comercial de oportunidades: rank, produto, preco,
desconto, sinais, score e status ficam no mesmo ritmo de leitura. Resumos de
analytics sao uma linha operacional sem quatro cards independentes. Em telas
pequenas, a telemetria pode ocupar duas linhas e o rail se torna vertical para
preservar a ordem do fluxo.
