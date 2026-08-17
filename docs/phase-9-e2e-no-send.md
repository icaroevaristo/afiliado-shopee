# Phase 9 - E2E completo sem SEND

## Objetivo e entrypoint

A Fase 9 certifica a composição local dos contratos fechados das Fases 1-8 sem alcançar infraestrutura ou providers reais. O entrypoint de teste é `apps/worker/test/commercial-e2e-no-send.integration.test.ts`, derivado do integration test de dispatch já certificado na Fase 8 para preservar o caminho real de confirmação, outbox, publisher, worker e Sender em vez de criar um pipeline paralelo.

O cenário começa com um `ShopeeOfferRecord` OFFICIAL sintético e relógio fixo. Ele usa as funções e services reais de identidade, elegibilidade, ranking, fairness/policy, provenance, Copy V10, draft, confirmação, outbox/publisher, worker e Sender. Os boundaries externos/operacionais são substituídos por memória, mocks ou fakes.

## Call graph comprovado

`ShopeeOfferRecord local -> resolveShopeeProductIdentity -> commercialProductRejections -> snapshot fingerprint -> rankCommercialPromotionCandidates -> CommercialAutomationCandidateFlowService.listTargets -> CommercialAutomationPolicyService -> provenance validation -> CommercialPromotionCopyGenerationService -> CommercialMessageDraftService -> CommercialPipelineConfirmationService -> dispatch/outbox -> CommercialDispatchOutboxPublisher -> queue fake -> processWhatsAppDispatchJob -> SenderService -> MockWhatsAppProvider -> SENT/recovery contracts`.

A mesma execução happy-path mantém `productId`, `snapshotId`, revision/fingerprint, `candidateId`, `campaignId`, `groupId`, affiliateLink e `generatedCopyId` coerentes. A Copy V10 usada no downstream é a copy produzida pelo `CommercialPromotionCopyGenerationService` real; o caption/media vêm do `CommercialMessageDraftService` real.

## Boundaries reais e mockados

Reais no harness: identidade Shopee, eligibility, fingerprint comercial, ranking, fairness de target, policy readiness, provenance, Copy V10 validator/assembler/generation service, message draft, confirmação, lifecycle dispatch/outbox, publisher logic, worker processor e SenderService.

Mockados/fakeados: fonte Shopee remota, provider OpenAI, persistência operacional PostgreSQL, BullMQ/Redis operacional e Evolution/WhatsApp. O provider AI mockado retorna somente `headline` e `body`, conforme o contrato atual; CTA/link/hashtags são materializados pelo assembler real. `MockWhatsAppProvider` captura o payload final sem envio externo.

## Fixtures e determinismo

O relógio é fixo em `2026-08-01T12:00:00.000Z`. A oferta OFFICIAL, produto, campanha, grupo físico, snapshot e histories são sintéticos e explícitos. O ranking é executado com a entrada em duas ordens e produz a mesma ordem material. A fairness é executada com grupos permutados e preserva a mesma decisão de target.

O fingerprint comercial é calculado pelo contrato real e reaproveitado entre ProductLead, snapshot, candidate, provenance, Copy V10 e Sender. O provider AI mockado é chamado uma única vez quando a copy é gerada e a segunda geração compatível reutiliza cache `COPY_READY`.

## Happy path IMAGE e TEXT

IMAGE: imageUrl válida gera `CommercialMessageDraft` IMAGE; a mesma copy/draft segue por confirmação, dispatch/outbox, publisher, worker e Sender. O provider WhatsApp mockado recebe destino GROUP e `imageUrl`.

TEXT: a mesma oferta/candidate/target é executada com imagem ausente; o draft real faz fallback TEXT sem escolher outro candidato ou destino, e o provider mockado recebe payload sem `imageUrl`. Em ambos os cenários o affiliateLink validado permanece no caption exatamente uma vez.

## Fail-closed integrado

O harness comprova diretamente: produto inelegível; nenhum candidate elegível; target inativo; target indisponível; instance divergente; fingerprint físico divergente; daily limit; minimum interval; `nextEligibleAt`; affiliateLink ausente; provenance inválida; snapshot fingerprint divergente; e output Copy V10 inválido. Nenhum desses casos troca silenciosamente produto/campanha/target para esconder a falha.

Os boundaries downstream são certificados em conjunto com os testes reais de lifecycle: draft IMAGE estruturalmente inválido bloqueia antes de claim/provider; falha antes de confirmação não cria dispatch; transação dispatch/outbox faz rollback; falha de enqueue confirmada não duplica job; incerteza de enqueue vira `AMBIGUOUS`; falha determinística do provider segue `FAILED`; resultado incerto/timeout permanece não-retriável; sucesso possível do provider seguido de falha de persistência não dispara segundo envio; recovery posterior preserva a incerteza.

## Idempotência e concorrência

A geração de Copy V10 é candidate-scoped e cacheável: primeira execução materializa COPY_READY e uma reexecução compatível reutiliza a copy sem nova chamada ao provider AI mockado.

A matriz de lifecycle executa concorrência real/fake controlada para confirmação/materialização, candidate reservation, dispatch/outbox, publishers e Senders. O resultado certificado é no máximo um dispatch efetivo, um outbox efetivo, um enqueue para o jobId determinístico, um claim Sender e uma chamada ao provider WhatsApp mockado. `SENT` não é reenviado, `PROCESSING` não é redeliverado cegamente e `PUBLISHED` não produz novo enqueue.

## Estados e recovery

O lifecycle preserva os estados existentes: dispatch `PENDING`, `PROCESSING`, `SENT`, `FAILED`; outbox `PENDING`, `PUBLISHED`, `AMBIGUOUS`; e `investigationRequired` quando o recovery não consegue provar segurança. Nenhum estado ou política de retry foi criado na Fase 9.

Recovery/reconciliation cobre job determinístico já existente, crash pós-enqueue, outbox `PUBLISHED`, outbox `AMBIGUOUS`, execution stale pre-marker/pós-marker, concorrência de recovery e possível efeito externo sem persistência final. A regra permanece fail-closed: incerteza não autoriza uma segunda ação externa.

## GROUP / INDIVIDUAL e observabilidade

O cenário comercial candidate-scoped permanece GROUP com id, fingerprint e instance coerentes. O caminho INDIVIDUAL/legacy não é usado para representar esse fluxo. Logs de boundary continuam sanitizados pelos contratos das Fases 4, 7 e 8; os testes de Sender verificam que affiliateLink, destination físico e caption integral não aparecem no log de erro.

## Zero efeitos externos e limitações

Nenhum teste desta fase chama Shopee, OpenAI, Evolution ou WhatsApp reais; não conecta worker/scheduler operacional, Redis/BullMQ ou PostgreSQL reais; não cria job operacional; não executa SEND, migration, seed, db push ou SQL.

Esta é uma certificação E2E local. Ela comprova a composição dos contracts e boundaries com fakes/mocks determinísticos, mas não comprova conectividade, credenciais, latência, rate limits ou comportamento de uma futura execução operacional com providers reais. Essa validação exige autorização separada e permanece fora da Fase 9.
