# Energia Casa — Plano 4: CI, `.claude/` e assistente de energia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cumprir os passos 1, 2 e 3 do plano de entrega do M4 Capstone (`docs/plano-entrega-pos-ia.md`): CI com
todas as suítes, skills/comandos/agentes do projeto em `.claude/` e o assistente com agentes experts em
LangChain.js e RAG híbrido no Weaviate.

**Architecture:** Ver a spec `docs/superpowers/specs/2026-11-23-assistente-design.md`. Assistente em `agent/`,
TypeScript rodando direto no Node 22 (apagamento de tipos), fora de `app/` e de `supabase/`. Laboratório em Docker
(Weaviate + Postgres com as migrations e o seed). Testes com modelo roteirizado e store em memória.

**Tech Stack:** Node 22, `@langchain/core` 1.3.5, `@langchain/google-genai` 2.3.5 (Gemini), `weaviate-client` 3.15.3,
`zod` 4.6.7, `pg` 8.23.1, `node --test`, GitHub Actions, Postgres 17, Weaviate 1.32.

**Pedido:** Cesar, 23/11/2026: "faça os passos 1, 2 e 3... para o passo 3, posso usar o Gemini?" (sim: D1 da spec).

## Global Constraints

- Produção intocada: nada no Supabase, na Vercel, no coletor ou em `app/`. O assistente só lê.
- Dados simulados no laboratório. A chave do Gemini só em `agent/.env`.
- Todo número dito pelo assistente sai de ferramenta testada; crédito reaproveita `app/credits-months.js`.
- `npm test` roda sem rede e sem chave.
- Versões de dependência fixas e com pelo menos duas semanas de publicação.

## Tarefa 1: CI no GitHub Actions

**Files:** `.github/workflows/ci.yml`

- [x] Job `app`: `node --test app/tests/*.test.mjs`.
- [x] Job `coletor`: `node --test "supabase/functions/collect/tests/*.test.ts"`.
- [x] Job `sql`: serviço `postgres:17`, `scripts/test-db.sh` (bootstrap + migrations + testes). Depende do PR #3
  (sem ele a migration `20261122192350` falha com `schema "auth" does not exist`); por isso este ramo parte do ramo do PR #3.
- [x] Job `assistente`: serviços `postgres:17` e Weaviate 1.32, `lab/prepare-db.sh`, `npm ci`, `npm test`
  (com `AGENT_PG_URL` e `WEAVIATE_HOST`, os testes de integração rodam), `npm run eval:offline`.
- [x] `permissions: contents: read`; nenhum segredo usado.

## Tarefa 2: `.claude/` do projeto

**Files:** `.claude/settings.json`, `.claude/commands/*.md`, `.claude/agents/*.md`, `.claude/skills/*/SKILL.md`

- [x] `settings.json`: libera os comandos de teste; nega a leitura de `.env*`; pede confirmação para
  `supabase db push`, `vercel deploy` e `git push origin master`.
- [x] Comandos: `/testar` (as quatro suítes), `/nova-migration` (teste primeiro + revisão), `/publicar-app`
  (checklist da Vercel), `/perguntar` (assistente).
- [x] Subagentes: `revisor-migration`, `revisor-assistente`, `avaliador-assistente` (todos só leitura).
- [x] Skills: `convencoes-energia` (regras de domínio com a fonte de cada uma) e `nova-ferramenta-assistente`.

## Tarefa 3: spec do assistente

- [x] `docs/superpowers/specs/2026-11-23-assistente-design.md`, com as decisões D1 a D12 e as alternativas.

## Tarefa 4: dados e ferramentas

**Files:** `agent/src/data/*`, `agent/src/tools/{dias,creditos,coleta}.ts`, `agent/tests/tools.test.ts`, `agent/tests/postgres.test.ts`

- [x] Teste: `resumo_dia` bate com `app/demo.js`; `comparar_periodo` com dados à mão (média 14, dia 20, boiler +6);
  `creditos` dá 212 kWh compensados e 100 de sobra em 09/2026 e a conferência fecha; `status_coleta` cobre em dia,
  atrasada, falhando e pausa noturna.
- [x] `DataProvider` demo e postgres; ferramentas com zod e campo `fonte`.
- [x] Teste do postgres contra o seed: boiler 3 kWh, ar 3,6 kWh, consumo 15 kWh no dia (curvas do `seed_demo.sql`).

## Tarefa 5: RAG

**Files:** `agent/src/rag/*`, `agent/src/tools/buscar.ts`, `agent/knowledge/regras-energia.md`, `agent/tests/rag.test.ts`, `agent/tests/weaviate.test.ts`

- [x] Teste: corte por título ignora `#` em bloco de código; BM25; fusão híbrida; contas sem CPF; a busca pelo
  mínimo faturado traz `regras-energia.md` no topo; a busca de operação acha a "Pausa noturna".
- [x] Store em memória e Weaviate (`selfProvided`, `hybrid`, `alpha = 0.5`); embeddings Gemini e por hashing.
- [x] Teste de integração do Weaviate (indexa as quatro coleções e repete a busca), no CI.

## Tarefa 6: roteador, experts e loop

**Files:** `agent/src/router.ts`, `agent/src/experts/*`, `agent/src/scripted-model.ts`, `agent/tests/{router,loop}.test.ts`

- [x] Teste: saída estruturada; reserva por palavras-chave com erro do modelo, expert inválido ou resposta sem
  ferramenta; loop com ferramenta, erro de ferramenta, ferramenta desconhecida e limite de passos.
- [x] `ScriptedChatModel` (um `BaseChatModel` de verdade) para os testes.

## Tarefa 7: checagem de números, registro e montagem

**Files:** `agent/src/{grounding,assistant,setup,cli}.ts`, `agent/src/obs/log.ts`, `agent/tests/{grounding,assistant}.test.ts`

- [x] Teste: números em português e de máquina, datas ignoradas, porcentagem de fração; número inventado aparece
  em `sem_fonte`; de ponta a ponta para os três experts; expert não recebe ferramenta de outro; erro vira registro.
- [x] CLI e ingestão com `--data`, `--store`, `--embed`, `--offline`.

## Tarefa 8: avaliação e laboratório

**Files:** `agent/eval/*`, `agent/src/offline-policy.ts`, `agent/lab/*`, `agent/README.md`

- [x] Dataset com 10 perguntas e critérios (expert, ferramentas, números, palavras, documento, sem alucinação, sem erro).
- [x] `eval:offline` 9/9 (a pergunta `rag-contadores-tuya` só roda com o Gemini); resultado versionado.
- [x] `docker-compose.yml` (só em 127.0.0.1) e `prepare-db.sh` (recusa banco com `readings`).
- [ ] `npm run eval` com o Gemini: precisa da `GEMINI_API_KEY` do Cesar em `agent/.env`.

## Resultado em 23/11/2026

| Suíte | Resultado |
|---|---|
| App | 53/53 |
| Coletor | 66/66 |
| SQL (Postgres 16 local, ramo do PR #3) | 15/15 arquivos |
| Assistente (`npm test`) | 43 testes: 41 passam, 2 pulados sem Weaviate/Postgres; com o Postgres do laboratório, 42 passam |
| Avaliação offline | 9/9 |

O teste do Weaviate não rodou neste ambiente (o registro de imagens Docker recusou o download); roda no CI.
