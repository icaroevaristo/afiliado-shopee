# Operação diária pelo Dashboard

Este é o guia curto para operar o Afiliado Shopee. O Dashboard é a autoridade
para as configurações comerciais; o System Supervisor continua responsável por
processos, filas, recovery e desligamento.

## Começar e parar

1. Dê dois cliques em **Shopee Affiliate**.
2. Aguarde o navegador abrir o Dashboard em `http://localhost:3000`.
3. Para encerrar o sistema, use **Shopee Affiliate - Encerrar**.

Fechar o navegador não encerra o sistema. Abrir o atalho novamente apenas
reabre o painel se o sistema já estiver saudável. Não é necessário abrir
terminais para a operação normal.

## Ligar ou desligar a automação

Abra **Automação** e confira o indicador **AUTOMAÇÃO LIGADA** ou
**AUTOMAÇÃO DESLIGADA**.

- **Ligar automação** retira a pausa persistida somente depois da confirmação.
- **Desligar automação** persiste a pausa como ação de segurança.
- Iniciar ou encerrar o sistema não liga a automação automaticamente.

O painel mostra a janela, timezone, intervalo mínimo, stagger, limites, próximo
envio, uso do dia e blockers. Uma configuração que mudou em outra aba exige
atualizar a tela e confirmar novamente; não repita a ação automaticamente.

## Agenda global

Em **Automação**, configure horário inicial e final, timezone, intervalo mínimo,
stagger, limite diário total, limite por grupo e os limites diários de Shopee e
OpenAI quando exibidos. A janela final é exclusiva. O cron, quando mostrado em
uma área avançada, é somente uma representação técnica: a operação normal é
feita pelos campos de horário e cadência.

## Grupos, números e campanhas

Em **Grupos e WhatsApps**:

- confira se o grupo está ativo, disponível e sem blocker;
- ative ou pause o grupo conforme o fluxo operacional;
- escolha as instâncias e mantenha a ordem desejada;
- cada grupo sem campanha possui o botão **Configurar campanha**.

Em **Campanhas**:

- escolha o grupo e o nicho;
- informe nome, cadência, janela e limite diário;
- revise a campanha antes de ativá-la;
- a alteração de nicho ou agenda invalida a revisão anterior, sem restart.

O grupo define onde publicar, a campanha define quando e quanto publicar, o
nicho define quais produtos podem entrar e as instâncias definem por qual
número publicar. A campanha nasce inativa e as ações de ativar/desativar pedem
confirmação.

## Criar e testar um nicho

Abra **Nichos** e clique em **Novo nicho**. Informe um nome, selecione as
categorias pelo nome quando necessário, adicione palavras obrigatórias ou
excluídas e preencha os filtros numéricos. O botão **Testar nicho** executa um
preview somente de leitura sobre o catálogo `OFFICIAL` já persistido. Ele não
consulta a Shopee, não gera IA, não cria candidato, fila, copy ou envio.

Use a explicação do formulário:

- sem categorias selecionadas significa qualquer categoria;
- uma palavra obrigatória deve aparecer no título (qualquer uma das entradas);
- qualquer palavra excluída rejeita o produto;
- todos os filtros numéricos preenchidos precisam ser satisfeitos.

Depois de revisar as amostras compatíveis e rejeitadas, salve o nicho. Para
desativar um nicho usado por campanhas, confirme o aviso. As campanhas não são
redirecionadas: permanecem registradas, mas deixam de selecionar produtos até
reativação ou troca explícita.

## Exemplos de operação

### Maternidade

Crie o nicho **Maternidade**, selecione as categorias observadas de bebês e
adicione palavras como `fralda`, `mamadeira` ou `carrinho de bebê`. Teste o
resultado, ajuste os filtros e só então vincule o nicho a uma campanha do grupo.

### Achadinhos até R$50

Crie **Achadinhos até R$50** sem categoria e sem palavra obrigatória. Use preço
máximo `50` e defina desconto, avaliação, vendas, comissão e score conforme a
política do proprietário. O nicho pode combinar produtos de categorias
diferentes porque não é uma categoria Shopee.

### Achadinhos Maternidade

Combine as categorias/palavras de Maternidade com preço máximo `50`. Assim, o
produto precisa passar tanto pelas regras temáticas quanto pelo limite de
preço.

Os valores de desconto e comissão usam percentual humano; avaliação usa a
escala de 0 a 5; score usa 0 a 100; vendas são inteiras; preço é informado em
reais com centavos.

## Blockers e necessidade de restart

Leia o blocker exibido pelo painel antes de tentar novamente. Indisponibilidade
de grupo ou instância, campanha inativa, nicho inativo, pausa, limite atingido
e falta de readiness são estados diferentes e não devem ser contornados por
uma ação manual improvisada.

Alterar nicho, campanha, agenda, grupo ou assignment não exige restart: a API
persiste a mudança com a revisão de configuração apropriada. Não há botão de
retry/reprocessamento de dispatch no Dashboard. Processos e filas só devem ser
iniciados ou encerrados pelos atalhos oficiais.
