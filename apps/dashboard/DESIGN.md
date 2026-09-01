# Shopee Affiliate — Design System do Dashboard 2.0

Status: especificação 27B.1. Este documento define a direção para a próxima
implementação visual; não altera componentes, CSS, rotas ou regras comerciais
nesta fase.

O produto é um painel local para uma pessoa proprietária acompanhar ofertas,
grupos, números e automação. A interface deve parecer uma aplicação SaaS
operacional calma, não uma central técnica.

## 1. Princípios

1. **Primeiro a decisão do proprietário.** Cada tela responde o que está
   acontecendo, o que pode ser feito agora e qual será o próximo passo.
2. **Verdade antes de completude.** Exibir somente dados retornados pelo
   backend. Ausência é apresentada como “não disponível”, nunca como estimativa.
3. **Segurança visível.** Pausar, retomar, alterar rota e publicar são ações
   explícitas, confirmadas e com o estado persistido como autoridade.
4. **Progressive disclosure.** O fluxo diário mostra resumo; IDs, códigos,
   lifecycle, CAS, outbox, provider e fila técnica pertencem ao Diagnóstico
   avançado.
5. **Pouca carga cognitiva.** Uma página tem uma tarefa principal, poucos
   estados concorrentes e uma hierarquia clara.
6. **Consistência local.** Reutilizar o proxy, os clientes de API e os
   componentes de estado atuais; o redesign não cria uma segunda regra de
   negócio.
7. **Português brasileiro.** Ações, estados, ajuda e erros para o proprietário
   ficam em pt-BR; nomes técnicos só aparecem quando necessários no diagnóstico.

## 2. Referências

As referências são de estrutura e ritmo, não de cópia literal de layout,
marca ou componentes.

- [Cal.com](https://cal.com/) — navegação direta, configuração compreensível e
  poucos níveis de profundidade.
- [Dub](https://dub.co/) — cartões, tabelas, filtros e leitura de métricas sem
  transformar cada número em um painel independente.
- [Seline Analytics](https://seline.so/) — espaçamento, silêncio visual e
  hierarquia de dados.
- [Refero Styles](https://styles.refero.design/) — repertório visual para
  comparar padrões de SaaS; não é uma dependência nem uma fonte de conteúdo.

Direção própria: **Shopee Affiliate — Clean Operational SaaS**, com fundo
claro, laranja Shopee pontual e informação comercial no centro.

## 3. Cores

Os tokens abaixo substituem gradualmente os tokens escuros atuais. O laranja
de marca não deve ser usado como texto pequeno sobre branco; ações preenchidas
usam a variante forte e passam por verificação WCAG AA.

| Token                 | Valor     | Uso                                       |
| --------------------- | --------- | ----------------------------------------- |
| `--sa-canvas`         | `#F7F8FA` | fundo geral                               |
| `--sa-surface`        | `#FFFFFF` | cartões e superfícies principais          |
| `--sa-surface-muted`  | `#F1F3F5` | filtros, áreas de apoio e estados neutros |
| `--sa-border`         | `#D9DEE5` | divisórias e campos                       |
| `--sa-text`           | `#17202A` | títulos e valores principais              |
| `--sa-text-secondary` | `#475467` | descrição e metadados legíveis            |
| `--sa-text-muted`     | `#667085` | ajuda e informação secundária             |
| `--sa-brand`          | `#EE4D2D` | marca, ícone ativo e acento               |
| `--sa-action`         | `#C7381F` | botão primário e links de ação            |
| `--sa-success`        | `#147D55` | enviado, conectado, pronto                |
| `--sa-warning`        | `#8A5A00` | atenção, pausa, aguardando                |
| `--sa-danger`         | `#B42318` | falha, exclusão, risco                    |
| `--sa-info`           | `#175CD3` | informação e orientação                   |

Sucesso, atenção e erro usam texto, ícone e rótulo além da cor. Não usar
laranja em todos os botões nem gradientes, glow ou fundos saturados.

## 4. Tipografia

- Usar a pilha sans já disponível no sistema; não introduzir uma fonte remota
  apenas por estética.
- Título da página: 28/34 px, peso 650–700.
- Título de seção: 18/24 px, peso 650.
- Corpo: 15/22 px para leitura confortável; texto auxiliar: 13/18 px.
- Valor operacional importante: 24/30 px, peso 650, com números tabulares.
- Labels devem usar frase normal, não caixa alta espalhada.
- Monospace fica restrito a Diagnóstico avançado, IDs, hashes e valores que
  precisem ser copiados tecnicamente.

## 5. Espaçamento

Usar escala de 4 px com ritmo predominante de 8 px:

`4, 8, 12, 16, 24, 32, 40, 48`.

O conteúdo de uma seção usa 24 px; a separação entre seções usa 32 px. Cards
com informação relacionada usam 16–20 px internos. Bordas têm raio de 10 px
em cards e 8 px em campos/botões; evitar pills gigantes fora de status.

## 6. Grid e layout

- Desktop: sidebar de aproximadamente 240 px, conteúdo com largura máxima de
  1200–1280 px e margem fluida.
- A área principal começa com um resumo curto e segue para uma tarefa ou lista;
  não usar uma parede de métricas.
- Usar uma grade de 12 colunas apenas quando ela melhorar a comparação. O
  padrão é uma coluna; duas colunas ficam para resumo + detalhe.
- Tablet: quebrar colunas antes de comprimir tabelas e formulários.
- Mobile: uma coluna, ações empilhadas e conteúdo prioritário antes dos
  detalhes técnicos.
- A navegação e o cabeçalho devem continuar acessíveis sem depender de hover.

## 7. Sidebar e navegação

Marca: “Shopee Affiliate”. Subtítulo preferencial: “Operação diária”. Não usar
“Operations console” como identidade principal.

Navegação principal proposta:

1. **Início** — visão diária e pendências.
2. **Ofertas** — catálogo, filtros, detalhes e Cupons como aba/seção secundária.
3. **Grupos** — grupos, estado, campanha e número responsável.
4. **WhatsApps** — instâncias/números e quantidade de grupos atribuídos.
5. **Automação** — ligar/desligar, agenda, limites e budgets.
6. **Histórico** — envios e resultados persistidos.
7. **Configurações** — saúde local e preferências não comerciais.

“Diagnóstico avançado” fica discreto dentro de Configurações ou em uma área
secundária, nunca como chamada primária para o proprietário.

Decisões de arquitetura de informação:

- **Cupons** vivem dentro de Ofertas porque são contexto de uma oferta; a
  página atual continua acessível durante a migração.
- **Campanhas** são entidades reais do backend, mas não precisam ocupar o
  primeiro nível. A campanha aparece no detalhe do grupo e no contexto de
  Automação; uma rota legada deve continuar redirecionando para preservar
  links.
- **Fila**, **Pipeline** e **Copies** são subvisões de Ofertas/Histórico ou
  Diagnóstico, conforme o dado disponível, e não devem competir com as sete
  decisões principais.

## 8. Cards

- Um card tem um propósito: resumo, estado, detalhe ou ação.
- No máximo quatro indicadores principais no primeiro viewport; combinar
  “envios hoje / limite” em uma unidade, por exemplo.
- Superfície branca, borda sutil e sombra mínima. Não aninhar card dentro de
  card sem uma relação visual indispensável.
- Cabeçalho: título claro, contexto opcional e uma ação. Rodapé: atualização
  ou próxima ação quando necessário.
- Card de estado da automação deve dominar visualmente a tela de Automação,
  com “AUTOMAÇÃO LIGADA” ou “AUTOMAÇÃO DESLIGADA”.

## 9. Botões

- Primário: uma ação principal por área, laranja forte, verbo no infinitivo
  (“Salvar”, “Ligar automação”, “Atualizar”).
- Secundário: leitura, navegação e ações de baixo risco.
- Perigo: somente desligar, desativar ou ação destrutiva, com confirmação.
- Altura mínima de 44 px no mobile e área de toque equivalente em desktop.
- Estado ocupado desabilita o botão e explica a espera; nunca cria duas
  requisições.
- Não oferecer “retry”, “reenviar” ou “publicar” onde o contrato do backend
  não autorizar essa ação.

## 10. Inputs e formulários

- Todo campo tem label persistente, unidade e ajuda curta quando houver risco
  de interpretação.
- Horário mostra “Início da janela” e “Fim da janela”; nunca exige cron.
- Limites ficam separados: “Mensagens por dia”, “Uso Shopee por dia” e “Uso
  OpenAI por dia”.
- Erros aparecem junto ao campo e em um resumo no topo; valores válidos não
  desaparecem quando outro campo falha.
- A edição usa a revisão/CAS retornada pela API. Conflito orienta “Atualize e
  confirme novamente”, sem reenvio automático.

## 11. Tabelas e listas

- Desktop pode usar tabela para muitas ofertas/envios; mobile converte cada
  linha em um cartão legível.
- Ordem de leitura: identidade, valor comercial, estado, próxima ação.
- Colunas técnicas (IDs, fingerprint, outbox, tentativas internas) ficam
  ocultas na visão comum e disponíveis no detalhe avançado.
- Nunca truncar o nome do produto sem uma forma acessível de leitura completa.
- Cabeçalhos descrevem a unidade (“Desconto”, “Envios hoje”, “Próximo envio”).
- Paginação e contagem vêm da API; não fingir uma lista completa quando o
  endpoint é paginado.

## 12. Filtros

- Primeira linha: busca simples e quatro atalhos úteis — Todos, Mais vendidos,
  Maior desconto, Maior comissão.
- Filtros avançados ficam em “Mais filtros”: categoria, preço, score,
  comissão, disponibilidade, origem, período e envio.
- “Limpar filtros” é sempre visível quando houver filtro ativo.
- Filtros não disparam ações comerciais; apenas consultam dados já persistidos.
- A tela mantém o resumo do resultado e o estado de carregamento sem apagar a
  última leitura válida de forma abrupta.

## 13. Badges e status

Rótulos do proprietário:

- Automação: **Ligada / Desligada**.
- Instância: **Ativa / Inativa** e **Operando / Pausada**.
- Grupo: **Ativo / Inativo** e **Disponível / Indisponível**.
- Oferta: **Ativa / Expirada / Indisponível**.
- Envio: **Enviado / Em andamento / Aguardando / Falhou / Resultado incerto**.
- Pendência: **Requer atenção**.

O rótulo técnico pode acompanhar o estado em Diagnóstico avançado. Badges são
curtos, não substituem uma frase explicativa e nunca comunicam estado só pela
cor.

## 14. Estados vazios

Um vazio deve dizer o que foi consultado, por que está vazio quando isso é
conhecido e qual é o próximo passo legítimo. Exemplos:

- “Nenhuma oferta corresponde aos filtros.” → “Limpar filtros”.
- “Nenhum grupo disponível.” → explicar que a descoberta/conexão ainda não
  está disponível, sem inventar um botão de convite.
- “Nenhum envio registrado.” → orientar que o histórico será preenchido pelo
  fluxo oficial.

Não criar produto, grupo, número, review ou métrica fictícia para preencher
espaço.

## 15. Loading

- Mostrar skeleton ou mensagem contextual na área afetada.
- Ações de leitura exibem “Atualizando…” e preservam dados anteriores quando
  seguro.
- Se a operação ultrapassar o tempo esperado, oferecer erro acionável; nunca
  deixar spinner infinito sem explicação.
- Polling moderado e pausado quando a aba estiver oculta, usando o cliente de
  API existente.

## 16. Erros

- Mensagem principal em português: o que não foi possível fazer e o que o
  proprietário pode tentar.
- Erros de API, códigos, IDs e stack ficam no Diagnóstico avançado/log local.
- Erro parcial não apaga seções que carregaram corretamente; marcar a fonte
  indisponível.
- Falha de autenticação do control plane deve dizer para atualizar/reabrir o
  painel, sem mostrar token ou header.
- Não converter um bloqueio de segurança em botão de retry automático.

## 17. Confirmações perigosas

- Desligar automação: explicar que impede novos trabalhos, sem matar o sistema.
- Ligar automação: explicar que a agenda poderá operar após os gates normais.
- Alterar assignment: mostrar grupo, número responsável e aviso de lifecycle;
  bloquear se o backend retornar conflito.
- Publicação manual: mostrar oferta, grupo único, copy e consequência antes de
  exigir a confirmação exata do contrato.
- A confirmação deve ser idempotente no cliente, não desaparecer em duplo
  clique e não repetir a chamada após erro de resultado incerto.

## 18. Mobile e responsividade

- Sidebar vira drawer com foco gerenciado, botão de fechar e link “Pular para
  o conteúdo”.
- Cards de Início e Automação ocupam uma coluna; o estado principal vem antes
  de detalhes.
- Tabelas viram cartões ou rolagem horizontal controlada; não reduzir fonte a
  ponto ilegível.
- Filtros avançados usam painel recolhível; ações importantes permanecem
  fixadas no final do formulário, não em uma barra invisível.
- Dialogs usam margem segura, rolagem interna e Escape quando não houver ação
  em andamento.

## 19. Acessibilidade

- Manter `lang="pt-BR"`, landmarks semânticos, hierarquia única de headings e
  labels associados.
- Todo controle funciona por teclado e tem foco visível; ícones decorativos
  usam `aria-hidden`.
- Status usa texto/ícone além de cor; contraste de texto e controles deve
  atender WCAG AA.
- Tabelas têm cabeçalhos, linhas focáveis quando interativas e alternativa
  mobile equivalente.
- Mensagens de sucesso/erro usam regiões `aria-live` apropriadas, sem anunciar
  polling a cada atualização.
- Respeitar `prefers-reduced-motion` e não usar animação para comunicar urgência.

## 20. Vocabulário

| Termo técnico atual     | Texto para o proprietário | Regra                                               |
| ----------------------- | ------------------------- | --------------------------------------------------- |
| Dispatch                | Envio                     | usar nas listas e detalhes comuns                   |
| Candidate               | Oferta selecionada        | usar quando explicar ranking/seleção                |
| Copy                    | Texto da oferta           | usar na visão comum; “copy” só no diagnóstico       |
| Destination             | Grupo                     | usar quando o destino for um grupo                  |
| Assignment              | Número responsável        | explicar a relação número → grupos                  |
| Scheduler               | Agenda automática         | não expor “scheduler” no fluxo comum                |
| Queue                   | Fila de ofertas / envios  | “ofertas” para candidatos; “envios” para dispatches |
| Blocker                 | Pendência                 | usar “Requer atenção” quando acionável              |
| Provider                | Serviço conectado         | manter provider somente em diagnóstico              |
| Commercial automation   | Automação                 | texto principal da operação                         |
| Outbox                  | Registro de publicação    | somente diagnóstico avançado                        |
| Lifecycle               | Operação em andamento     | somente quando necessário para bloquear ação        |
| Readiness               | Pronto para operar        | usar com uma explicação curta                       |
| CAS / schedule revision | Versão da configuração    | não expor no fluxo comum                            |
| Fingerprint             | Identidade verificada     | mostrar apenas em diagnóstico                       |
| Budget externo          | Uso diário do serviço     | separar de limite de mensagens                      |

## 21. Padrões proibidos

- Tema escuro de command center, estética de terminal ou excesso de neon.
- Slogans, hero de marketing, depoimentos ou métricas que não vêm da API.
- IDs internos, hashes, cron, BullMQ, CAS e códigos de erro no primeiro nível.
- Inglês em labels, navegação ou estados destinados ao proprietário.
- Grade de muitos cards iguais, excesso de badges ou card dentro de card.
- Gradiente, glassmorphism, glow, blobs e cor laranja em toda a superfície.
- Botão de envio, retry, reprocessamento, sync, conexão ou convite sem
  endpoint e autorização correspondentes.
- Campos de secret no browser, `localStorage`, `sessionStorage` ou query string
  para credenciais.
- Acesso direto do dashboard a Prisma, Redis, BullMQ ou provider.
- Alterar regra de ranking, copy, quota, idempotência, routing sticky ou
  boundary de envio para resolver problema de apresentação.

### Limite desta especificação

O backend atual é a fonte de verdade. Quando uma tela futura precisar de uma
capacidade ausente, o plano deve registrar o gap e parar; não deve simular a
capacidade com estado local ou criar um endpoint genérico de comando.
