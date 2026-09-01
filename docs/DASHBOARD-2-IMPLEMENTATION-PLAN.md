# Dashboard 2.0 — Plano de implementação

Status: plano futuro derivado da auditoria 27B.1. Esta fase não implementa os
lotes abaixo. O dashboard atual continua sendo o runtime em produção local e
as APIs existentes continuam sendo a única fonte de dados.

## Escopo e regras de execução

- Implementar um lote por vez, com diff pequeno e revisão independente.
- Reutilizar `apps/dashboard/lib/api`, o proxy same-origin autenticado e as
  regras atuais do backend; não criar acesso direto a Prisma, Redis, BullMQ ou
  Evolution.
- Nenhuma mudança visual pode relaxar pause, CAS, sticky routing, idempotência,
  confirmação ou o boundary de envio.
- Cada lote deve ter estados de loading, vazio, erro, stale/offline e sucesso
  quando aplicável.
- IDs, códigos, lifecycle, outbox, provider e revisão ficam em Diagnóstico
  avançado, não no caminho diário.
- Gaps abaixo são decisões de produto/backend futuras, não autorização para
  implementá-los durante uma migração visual.

## Mapa de capacidade real

Legenda: `EXISTE_BACKEND_E_TELA` significa que há contrato no backend e leitura
ou controle correspondente no dashboard atual. `EXISTE_BACKEND_MAS_UX_ESCONDE`
significa que a capacidade existe, mas está técnica, dispersa ou pouco visível.
`EXISTE_BACKEND_SEM_TELA` significa que o contrato existe, porém a UI atual não
o oferece. `NÃO_EXISTE` significa que não há capacidade suportada pelo contrato
atual.

| Capacidade real                            | Evidência de API/serviço                                     | Classificação                 | Destino 2.0                                         |
| ------------------------------------------ | ------------------------------------------------------------ | ----------------------------- | --------------------------------------------------- |
| Saúde da API                               | `GET /health`                                                | EXISTE_BACKEND_E_TELA         | Início/Sistema, em linguagem “API online”           |
| Analytics persistido                       | `GET /analytics`                                             | EXISTE_BACKEND_E_TELA         | Início                                              |
| Estado de automação e readiness            | `/commercial-automation/status`                              | EXISTE_BACKEND_E_TELA         | Automação, resumo simples                           |
| Ligar/desligar automação                   | `PATCH /commercial-automation/settings`                      | EXISTE_BACKEND_E_TELA         | Automação, confirmação protegida                    |
| Janela, intervalo e stagger                | settings/schedule e settings/admin                           | EXISTE_BACKEND_E_TELA         | Automação                                           |
| Limites de mensagens                       | `dailyGlobalLimit`, `dailyGroupLimit`                        | EXISTE_BACKEND_E_TELA         | Automação, separados por escopo                     |
| Budgets diários Shopee/OpenAI              | usage e limites em `operational-admin`                       | EXISTE_BACKEND_E_TELA         | Automação, “uso do serviço”                         |
| Próximo slot/agenda                        | `/commercial-automation/scheduler` e `/schedule/preview`     | EXISTE_BACKEND_E_TELA         | Início/Automação; cron só avançado                  |
| Execuções comerciais                       | `/commercial-automation/executions`                          | EXISTE_BACKEND_MAS_UX_ESCONDE | Histórico/Diagnóstico                               |
| Outbox comercial                           | `/commercial-automation/outbox`                              | EXISTE_BACKEND_SEM_TELA       | Diagnóstico avançado                                |
| Filas, reservas e pendências               | `/operational-admin`                                         | EXISTE_BACKEND_MAS_UX_ESCONDE | Início como pendências; detalhes avançados          |
| Campanhas: listar/editar agenda            | `/commercial/campaigns`                                      | EXISTE_BACKEND_E_TELA         | Grupo/Automação; não precisa de menu próprio        |
| Campanhas: criar/ativar/desativar          | POST/PATCH e ações de campanha                               | EXISTE_BACKEND_SEM_TELA       | Futuro, após contrato de UX/perm.                   |
| Nichos: CRUD                               | `/commercial/niches`                                         | EXISTE_BACKEND_SEM_TELA       | Diagnóstico/configuração futura                     |
| Minerar campanha                           | `mining-preview` e `/mine`                                   | EXISTE_BACKEND_SEM_TELA       | Não expor sem desenho de custo/confirm.             |
| Fila de candidatos da campanha             | `/commercial/campaigns/:id/queue`                            | EXISTE_BACKEND_E_TELA         | Ofertas > Fila, sem jargão                          |
| Catálogo de ofertas                        | `/shopee/offers`                                             | EXISTE_BACKEND_E_TELA         | Ofertas                                             |
| Categorias observadas                      | `/shopee/offers/categories`                                  | EXISTE_BACKEND_E_TELA         | Filtro de Ofertas                                   |
| Filtros e ordenações de ofertas            | query de `/shopee/offers`                                    | EXISTE_BACKEND_E_TELA         | Busca + filtros avançados                           |
| Score, vendas, desconto, comissão e preço  | campos de `ShopeeOffer`                                      | EXISTE_BACKEND_E_TELA         | Card/tabela de Ofertas                              |
| Snapshot e histórico comercial             | detalhe de oferta                                            | EXISTE_BACKEND_E_TELA         | Detalhe da oferta; técnico em segundo nível         |
| Preview de copy de oferta                  | `/shopee/offers/:id/copy-preview`                            | EXISTE_BACKEND_SEM_TELA       | Ofertas > detalhe, somente preview                  |
| Sync oficial Shopee                        | `/shopee/offers/sync` bloqueado para CLI oficial             | EXISTE_BACKEND_SEM_TELA       | Manutenção/CLI; não botão diário                    |
| Importação manual Shopee                   | validate/import                                              | EXISTE_BACKEND_SEM_TELA       | Fluxo administrativo futuro                         |
| Geração de copy legada                     | `/copy/generate`                                             | EXISTE_BACKEND_SEM_TELA       | Não expor sem contrato comercial atual              |
| Copy comercial por candidate               | copy preview/generate/find                                   | EXISTE_BACKEND_SEM_TELA       | Diagnóstico ou fluxo dedicado futuro                |
| Hunter legado                              | `POST /hunter/run`                                           | EXISTE_BACKEND_SEM_TELA       | Manutenção técnica; não ação diária                 |
| Recalcular score                           | `POST /score/run`                                            | EXISTE_BACKEND_SEM_TELA       | Manutenção técnica; não ação diária                 |
| Cupons: leitura                            | `GET /coupons`                                               | EXISTE_BACKEND_E_TELA         | Ofertas > Cupons                                    |
| Cupons: criar/editar/excluir               | POST/PATCH/DELETE `/coupons`                                 | EXISTE_BACKEND_SEM_TELA       | Futura tela com confirmação                         |
| Pipeline legado: criar job                 | `POST /pipeline/run`                                         | EXISTE_BACKEND_SEM_TELA       | Manutenção; não ação diária                         |
| Pipeline legado: consultar job             | `GET /pipeline/jobs/:id`                                     | EXISTE_BACKEND_E_TELA         | Diagnóstico avançado                                |
| Dry-run comercial                          | `POST /commercial-pipeline/dry-run`                          | EXISTE_BACKEND_SEM_TELA       | Não expor como execução diária                      |
| Histórico de runs comerciais               | `/commercial-pipeline/runs` e detalhe                        | EXISTE_BACKEND_E_TELA         | Histórico/Diagnóstico                               |
| Confirmar publicação comercial             | `/commercial-pipeline/runs/:id/confirm`                      | EXISTE_BACKEND_SEM_TELA       | Se houver UI futura, contrato isolado e confirmação |
| Publicação manual de oferta                | options/create/status                                        | EXISTE_BACKEND_E_TELA         | Detalhe da oferta; exatamente um grupo              |
| Instâncias: listar/cadastrar/ativar/pausar | `/whatsapp/instances` e admin                                | EXISTE_BACKEND_E_TELA         | WhatsApps                                           |
| Conectar um novo WhatsApp                  | não há fluxo de sessão/QR/conexão                            | NÃO_EXISTE                    | Gap explícito; não chamar “conectar” ainda          |
| Número real do proprietário                | admin expõe nome, não número confiável                       | NÃO_EXISTE                    | Usar nome da instância                              |
| Grupos: listar estado e metadados          | `/whatsapp/groups`                                           | EXISTE_BACKEND_E_TELA         | Grupos                                              |
| Grupos: autorizar/desautorizar             | `PATCH /whatsapp/groups/:id`                                 | EXISTE_BACKEND_SEM_TELA       | Futuro com confirmação                              |
| Sincronizar diretório de grupos            | `POST /whatsapp/groups/sync` quando provider existe          | EXISTE_BACKEND_SEM_TELA       | Ação avançada; pode retornar diretório indisponível |
| Grupo: assignment sticky                   | `/whatsapp/groups/:id/admin`                                 | EXISTE_BACKEND_E_TELA         | Grupos, seleção de número                           |
| Destinos individuais                       | `/whatsapp/destinations`                                     | EXISTE_BACKEND_E_TELA         | Histórico/Diagnóstico; não misturar com grupos      |
| Criar/editar destino individual            | POST/PATCH destinos                                          | EXISTE_BACKEND_SEM_TELA       | Futuro, fora da visão de grupos                     |
| Dispatches e entrega                       | `/whatsapp/dispatches` e detalhe                             | EXISTE_BACKEND_E_TELA         | Histórico                                           |
| Status técnico do supervisor               | `system:status` local, não API do dashboard                  | EXISTE_BACKEND_SEM_TELA       | Diagnóstico; sem command execution                  |
| Ofertas Relâmpago                          | capability explícita `UNSUPPORTED_CURRENT_PROVIDER_CONTRACT` | NÃO_EXISTE                    | Mostrar “não disponível no contrato atual”          |
| Invite link de grupo                       | não há endpoint/contrato                                     | NÃO_EXISTE                    | Gap                                                 |
| Multi-sender                               | não há contrato operacional                                  | NÃO_EXISTE                    | Gap futuro                                          |

### Rotas atuais e destino visual

| Rota atual                         | Decisão para 2.0                                                         |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `/`                                | Início; manter dados reais, reduzir IDs e jargão                         |
| `/produtos` e `/produtos/[id]`     | Ofertas e detalhe da oferta                                              |
| `/whatsapp`                        | dividir visualmente em Grupos e WhatsApps usando o mesmo backend         |
| `/automacao`                       | Automação; simplificar o primeiro viewport e manter controles protegidos |
| `/envios`                          | Histórico de envios                                                      |
| `/configuracoes`                   | Configurações; saúde e orientações, detalhes técnicos em Diagnóstico     |
| `/campanhas`                       | compatibilidade/atalho para contexto de grupo e Automação                |
| `/fila`                            | subseção de Ofertas, com status traduzido                                |
| `/cupons`                          | subseção de Ofertas                                                      |
| `/copies`                          | subseção de Ofertas/Histórico enquanto não existir listagem de copies    |
| `/pipeline`, `/pipeline-comercial` | Diagnóstico avançado; preservar deep links                               |

## Gaps funcionais conhecidos (não implementar em 27B.1)

Estes pontos são limites reais do contrato atual ou decisões de segurança. O
Dashboard 2.0 deve comunicar o limite com honestidade e parar; não criar uma
simulação local para parecer completo.

| Gap                                | Evidência atual                                                                                                                                                     | Decisão                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Diretório de grupos indisponível   | as rotas dependem de `groupDirectoryService` e podem responder `WHATSAPP_GROUP_DIRECTORY_UNAVAILABLE`                                                               | mostrar indisponível e orientar a próxima ação suportada                         |
| Conectar nova instância/número     | não há sessão, QR, login ou handshake de WhatsApp; cadastrar nome não conecta um número                                                                             | não exibir “Conectar” como se estivesse implementado                             |
| Cadastrar/sincronizar novos grupos | o sync depende do diretório/provider e não há criação manual segura no painel                                                                                       | manter descoberta como operação futura/avançada                                  |
| Invite link                        | não há endpoint nem contrato de convite                                                                                                                             | não criar CTA fictício                                                           |
| Multi-sender                       | o contrato atual não suporta distribuição para vários remetentes                                                                                                    | manter um número responsável por grupo                                           |
| Ofertas Relâmpago/provider         | `flashDealCapability` declara `UNSUPPORTED_CURRENT_PROVIDER_CONTRACT`                                                                                               | informar indisponibilidade, sem filtro ou promessa                               |
| Backend existente sem tela         | nichos, mineração, sync oficial, importação, geração de texto, mutações de cupom, outbox, Hunter, Score e criação de jobs têm contratos parciais ou administrativos | listar em Diagnóstico/Manutenção somente quando houver UX e autorização próprias |

## Lotes de implementação futura

### Lote 1 — Shell, navegação e tokens

- **APIs reutilizadas:** nenhuma nova; `getHealth` apenas para o pulso do
  shell.
- **Componentes:** `AppShell`, `PageHeader`, `OpsPageHeading`, `OpsSection`,
  `StatusBadge`/`OpsBadge`, estados de loading/erro/vazio e tokens globais.
- **Entrega:** tema claro, marca “Operação diária”, menu de sete itens, drawer
  mobile e rota discreta de Diagnóstico.
- **Riscos:** perder links existentes, contrastes ou o skip link; manter rotas
  legadas como alias/redirect.
- **Testes:** navegação desktop/mobile, teclado, foco, `lang`, snapshot de
  labels e ausência de termos técnicos no menu.
- **Gaps:** nenhum novo; status detalhado do supervisor continua sem API de
  tela comum.

### Lote 2 — Início

- **APIs reutilizadas:** `getHealth`, `getAnalytics`, status/scheduler de
  automação, `getOperationalAdmin`, execuções e dispatches.
- **Componentes:** cartão de estado da automação, resumo “hoje”, próximo envio,
  pendências, atividade recente e rail Produto → Oferta → Texto → Envio → Grupo
  → Enviado.
- **Riscos:** polling excessivo, dados parciais e IDs no primeiro viewport.
- **Testes:** carregamento paralelo, stale/offline, vazio, retry de leitura,
  timezone e acessibilidade do rail.
- **Gaps:** não há um agregado único para todos os serviços do supervisor;
  mostrar somente os sinais existentes.

### Lote 3 — Ofertas, detalhe e Cupons

- **APIs reutilizadas:** ofertas, categorias, detalhe/snapshots, delivery,
  preview de copy e `GET /coupons`.
- **Componentes:** busca, filtros rápidos, painel avançado, cards responsivos,
  tabela desktop, detalhe comercial e aba de Cupons.
- **Riscos:** tabela larga, números sem contexto e confusão entre preview e
  envio; manter Ofertas Relâmpago explicitamente indisponível.
- **Testes:** filtros combinados, paginação, imagens seguras, categorias
  indisponíveis, snapshot histórico, mobile e nenhuma chamada de sync/provider.
- **Gaps:** sync oficial e importação são fluxos administrativos; CRUD de
  cupons e listagem de copies não têm tela atual.

### Lote 4 — Grupos

- **APIs reutilizadas:** `getOperationalAdmin`, grupos, campanhas e atualização
  administrativa de grupo.
- **Componentes:** lista de grupos, filtros por estado/número/campanha, cartão
  de grupo, assignment “Número responsável”, pendências e histórico resumido.
- **Riscos:** trocar assignment durante lifecycle, CAS obsoleto e confundir
  disponibilidade com autorização.
- **Testes:** CAS/409, lifecycle ativo bloqueando troca, sticky routing,
  atualização simultânea, grupo indisponível e confirmação.
- **Gaps:** descoberta/sync pode estar indisponível; invite link não existe.

### Lote 5 — WhatsApps

- **APIs reutilizadas:** instâncias e visão operacional existentes.
- **Componentes:** cartão de instância, status conectado/indisponível somente
  quando o backend suportar, contador derivado de assignments, último/próximo
  envio e bloqueios.
- **Riscos:** chamar “Conectar” algo que hoje apenas cadastra um provider name;
  não exibir número inventado nem health não confirmado.
- **Testes:** ativar/desativar/pausar com CAS, erro de confirmação, contagem
  derivada dos grupos e nenhum fallback silencioso.
- **Gaps:** conexão/QR/sessão de um novo WhatsApp não existe; CTA deve ser
  “disponível em breve” ou permanecer fora do MVP.

### Lote 6 — Automação

- **APIs reutilizadas:** status, pause/resume, settings, schedule preview,
  scheduler e `operational-admin`.
- **Componentes:** toggle grande, editor de janela/intervalo/stagger, limites
  de mensagens, uso Shopee/OpenAI, próximo envio e pendências.
- **Riscos:** mostrar `enabled=true` como ligada quando `paused=true`, perder
  revisão/CAS, salvar campos parcialmente ou expor cron como configuração
  comum.
- **Testes:** pause/resume, conflito 409, timezone, limites mínimos/máximos,
  budgets separados, janela inválida e dupla submissão.
- **Gaps:** qualquer novo controle precisa de contrato; não criar edição de
  cron ou scheduler pelo dashboard.

### Lote 7 — Histórico

- **APIs reutilizadas:** dispatches, execuções, outbox somente leitura e runs
  comerciais.
- **Componentes:** timeline simples, filtros, detalhe lateral e estados
  “Enviado”, “Falhou” e “Resultado incerto”.
- **Riscos:** oferecer retry/reprocessamento, mostrar destino bruto ou misturar
  histórico com ação manual.
- **Testes:** filtros, paginação, detalhe, estados ambíguos, mascaramento,
  tentativa única e ausência de mutações.
- **Gaps:** outbox e detalhes do supervisor podem exigir a área avançada.

### Lote 8 — Configurações

- **APIs reutilizadas:** health e scheduler somente leitura; status de
  automação linkado para Automação.
- **Componentes:** saúde local, links de ajuda, timezone e preferências que já
  tenham contrato.
- **Riscos:** transformar uma tela informativa em executor de shell, prometer
  estado de Docker sem fonte confiável ou duplicar controles de Automação.
- **Testes:** API offline, scheduler indisponível, links, ausência de secrets e
  nenhuma chamada privilegiada no browser.
- **Gaps:** status completo do System Supervisor precisa de um contrato seguro
  se for futuramente exibido.

### Lote 9 — Diagnóstico avançado

- **APIs reutilizadas:** execuções, outbox, scheduler, fila, blockers e
  endpoints de histórico já existentes.
- **Componentes:** tabelas técnicas, códigos, IDs copiáveis, timeline de
  lifecycle e detalhes de recovery.
- **Riscos:** tornar o diagnóstico o caminho padrão, vazar segredo ou adicionar
  endpoint genérico de command execution.
- **Testes:** sanitarização, auth do proxy, limites de payload, links internos e
  ausência de ações de envio/retry.
- **Gaps:** detalhes ausentes devem permanecer “não disponível”, não ser
  inferidos de Redis ou de logs no frontend.

### Lote 10 — Responsividade, acessibilidade e polish

- **APIs reutilizadas:** nenhuma nova.
- **Componentes:** tokens, tabela/card responsivo, drawer, dialogs e estados
  compartilhados.
- **Riscos:** corrigir aparência alterando regra de negócio, perder foco em
  modal ou criar diferenças de estado entre desktop e mobile.
- **Testes:** viewport mobile/desktop, teclado, contraste, reduced motion,
  leitores de tela quando disponíveis, loading/erro/vazio e regressão visual.
- **Gaps:** registrar limitações de dados sem criar placeholders falsos.

## Critérios de aceite de cada lote

1. O lote consome somente APIs documentadas e preserva o proxy autenticado.
2. A tela comum não exige conhecer termos técnicos do glossário.
3. Ação mutável tem confirmação/CAS conforme contrato e não repete após
   resultado incerto.
4. Nenhum secret aparece em HTML, logs de teste, estado do cliente ou query
   string.
5. Testes cobrem sucesso, vazio, loading, erro e concorrência pertinente.
6. O diff não altera ranking, copy validation, dispatch/outbox, SenderService,
   recovery, quotas ou provider boundary sem uma missão própria.
