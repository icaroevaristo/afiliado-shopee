# Nichos comerciais

## Modelo canônico

O modelo operacional é:

```text
Grupo -> Campanha -> Nicho
Grupo -> instâncias WhatsApp ordenadas
```

Grupo é o destino, campanha é agenda e volume, nicho é conteúdo e instância é
remetente. Não existe uma entidade paralela de “grupo nichado”. O mesmo nicho
pode ser reutilizado por várias campanhas e grupos; cada campanha conserva sua
própria janela, cadência, limite e identidade lógica.

## Regras do matcher

O matcher recebe uma oferta `OFFICIAL` já persistida e aplica todas as regras
do nicho:

- se `categoryIds` não estiver vazio, existe interseção com as categorias do
  produto;
- se `includeKeywords` não estiver vazio, pelo menos uma palavra/frase deve
  aparecer no título após normalização de acentos, caixa e pontuação;
- qualquer correspondência em `excludeKeywords` rejeita o produto;
- preço, desconto, avaliação, vendas, comissão e score precisam passar todos.

Categorias e palavras preenchidas são cumulativas. Categorias vazias significam
qualquer categoria; palavras obrigatórias vazias não filtram por título. O
backend normaliza e valida os valores, mesmo quando o Dashboard já faz a
validação de formulário.

## Campos e unidades

| Campo | Unidade operacional |
| --- | --- |
| `minPrice`, `maxPrice` | decimal em reais, preservado como string |
| `minDiscountRate` | percentual de 0 a 100 |
| `minRating` | avaliação de 0 a 5 |
| `minSales` | inteiro não negativo |
| `minCommissionRate` | percentual de 0 a 100 |
| `minimumScore` | inteiro de 0 a 100 |

O nome produz um slug estável. Keywords vazias não filtram o título e entradas
duplicadas são deduplicadas pelo backend; category IDs também são normalizados
e deduplicados. `minPrice` não pode ser maior que `maxPrice`.

## Preview somente de leitura

**Testar nicho** aceita um draft ainda não salvo. O endpoint de preview lê
somente o catálogo `OFFICIAL` local, avalia um lote limitado no servidor e
retorna contagens, motivos e amostras sanitizadas. Não grava nicho, snapshot,
candidate, copy, dispatch ou outbox; também não chama Shopee, OpenAI, Evolution
ou BullMQ.

O resultado mostra produtos avaliados, compatíveis, rejeitados, resumo por
motivo e no máximo dez amostras de cada lado. O preview de `Achadinhos` pode ter
`categoryIds=[]` e `includeKeywords=[]`, usando apenas os filtros comerciais.

## Nichos temáticos, transversais e híbridos

- **Temático:** Maternidade, Pet ou Gamer podem combinar categorias, keywords e
  filtros numéricos.
- **Transversal:** Achadinhos ou Alta Comissão podem não exigir categoria nem
  keyword e usar apenas preço, desconto, qualidade e score.
- **Híbrido:** Achadinhos Maternidade combina as regras temáticas com, por
  exemplo, `maxPrice=50`.

Maternidade não é hardcoded no backend e Achadinhos não exige uma categoria
oficial inventada. Os exemplos são configurações que o proprietário cria no
Dashboard.

## Campanhas, revisão e isolamento

Uma campanha referencia `nicheId`. Ao trocar o nicho, o update administrativo
incrementa a `scheduleRevision`; jobs/targets com a revisão anterior devem
falhar fechado. Campanhas ativas não podem trocar para nicho inativo. A
alteração vale sem restart, mas não reaproveita silenciosamente a agenda antiga.

Candidatos pertencem à campanha, ao produto e ao snapshot correspondentes. A
seleção deve validar `candidate.campaignId`, `campaign.nicheId` e a identidade
lógica do grupo. Não existe fallback de candidato entre campanhas: um produto
de Maternidade não pode ser consumido pela campanha de Achadinhos por acidente.

O dedupe continua sendo por grupo lógico e pelo período configurado. O mesmo
produto pode ser elegível para grupos diferentes, enquanto a mesma identidade
de grupo permanece protegida contra repetição conforme a política existente.

## Decisões permanentes

1. Nicho não é categoria Shopee.
2. Achadinhos é um nicho transversal baseado em regras comerciais.
3. Não existe entidade “grupo nichado”.
4. Grupo = destino; campanha = agenda/volume; nicho = conteúdo; instância =
   remetente.
5. O Dashboard é a autoridade operacional para configuração e pausa; o
   supervisor é a autoridade para processos, filas, recovery e shutdown.
6. Preview de nicho nunca pode gerar efeito externo.

Essas decisões preservam a separação entre segmentação, agenda, roteamento e
envio e evitam que uma necessidade de UX crie um segundo pipeline comercial.
