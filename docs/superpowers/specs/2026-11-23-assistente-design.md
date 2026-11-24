# Energia Casa — Assistente de energia (spec)

Data: 23/11/2026. Status: aprovada pelo Cesar para execução ("faça os passos 1, 2 e 3", com Gemini como LLM).
Base: plano de entrega do M4 Capstone (`docs/plano-entrega-pos-ia.md`, PR #4, seções 3 e 4).

## 1. Problema

O PWA mostra números (geração, consumo, rede, créditos), mas não explica. As perguntas que o Cesar faz a si
mesmo olhando o app são de "por quê" e "quanto falta":

- "Por que ontem consumi mais que a média?"
- "Quanto do saldo de créditos eu usei e quanto tempo ele dura?"
- "Por que a conta veio com 100 kWh se eu injetei mais do que consumi?"
- "A coleta da Tuya está funcionando?"

Responder exige juntar três coisas: os números do banco, as regras do próprio sistema (mínimo faturado,
hora do fim do intervalo, contadores da Tuya) e as regras da compensação de energia. Hoje isso está espalhado
entre views SQL, spec, `CLAUDE.md` e a cabeça do Cesar.

## 2. Objetivo e não objetivos

**Objetivo.** Um assistente de linha de comando que responde em português, com números conferidos e a fonte
de cada um, usando agentes experts em LangChain.js e RAG híbrido no Weaviate.

**Não objetivos.**
- Não vai para o PWA nem para o Supabase de produção. Roda num laboratório local.
- Não escreve nada no banco. Só lê.
- Não usa dado real da casa: o laboratório usa o seed de demonstração e as contas de exemplo sem dados pessoais.
- Não substitui as views: o assistente lê as mesmas views que o app.

## 3. Decisões

| # | Decisão | Alternativas consideradas | Motivo |
|---|---|---|---|
| D1 | LLM Gemini via `@langchain/google-genai` (`ChatGoogleGenerativeAI`), modelo por `GEMINI_MODEL` (padrão `gemini-3.8-flash`; o `gemini-2.5-flash` deixou de aceitar chaves novas em 23/11/2026) | Anthropic, OpenAI | escolha do Cesar; camada gratuita suficiente para o laboratório |
| D2 | Embeddings do Gemini (`GoogleGenerativeAIEmbeddings`, `GEMINI_EMBEDDING_MODEL`, padrão `gemini-embedding-001`), calculados no cliente e gravados no Weaviate como vetores próprios | módulo `text2vec-*` dentro do Weaviate | um provedor só, sem imagem de modelo de 2 GB no Docker; o Weaviate fica neutro e o mesmo código roda com o embedder local nos testes |
| D3 | Embedder local determinístico (`HashEmbeddings`, hashing de palavras e bigramas, 256 dimensões) como alternativa sem chave | só Gemini | testes e laboratório sem rede; a busca híbrida ainda acerta pelo BM25 |
| D4 | Busca híbrida (`alpha = 0.5`, vetor + BM25) | só vetor | termos exatos como "mínimo faturado", "ITAIPU", "power_signed_w" |
| D5 | Loop de ferramentas próprio sobre `BaseChatModel.bindTools` (máx. 6 passos) | `createAgent` do pacote `langchain` (LangGraph) | controle e registro de cada passo para a observabilidade; o teste usa um modelo roteirizado sem depender de internals do LangGraph; uma dependência a menos |
| D6 | Roteador com `withStructuredOutput` (zod `{ expert, motivo }`), com reserva por palavras-chave se o LLM falhar | só LLM; só regras | uma pergunta nunca fica sem expert, e a reserva é testável |
| D7 | Três experts: `consumo`, `creditos`, `operacao` | um agente único com todas as ferramentas | prompt menor e específico; ferramentas limitadas por expert; erro de um não contamina o outro |
| D8 | Ferramentas determinísticas com `tool()` + zod; crédito reaproveita `app/credits-months.js` | o LLM calcular | números saem de código testado, nunca do modelo |
| D9 | Checagem de números na resposta: todo número da resposta precisa aparecer (com tolerância de arredondamento) em algum resultado de ferramenta ou na pergunta | confiar no prompt | mede alucinação numérica por pergunta; vai para o log e para a avaliação |
| D10 | Fonte de dados plugável: `demo` (mesmas curvas do `app/demo.js`, sem banco) e `postgres` (laboratório com migrations + `seed_demo.sql`) | só Postgres | testes e avaliação offline rodam sem Docker |
| D11 | Store vetorial plugável: `memory` (híbrido em memória, mesma fórmula de fusão) e `weaviate` | só Weaviate | testes sem Docker; o Weaviate é o store do laboratório |
| D12 | TypeScript com apagamento de tipos do Node 22 (`node src/cli.ts`), `node --test` | build com `tsc` | mesma pilha do coletor, sem etapa de build |

## 4. Arquitetura

```
pergunta
  └─ roteador (Gemini, saída estruturada; reserva por palavras-chave)
       └─ expert (prompt próprio + ferramentas permitidas)
            ├─ ferramentas de dados ── DataProvider (demo | postgres)
            │     resumo_dia, comparar_periodo, creditos, status_coleta
            └─ buscar_documentos ── VectorStore (memory | weaviate)
                  coleções ProjetoDocs, RegrasEnergia, Contas, ResumoDiario
       └─ checagem de números
  └─ registro JSON da pergunta (agent/logs/AAAA-MM-DD.jsonl)
```

### 4.1 Ferramentas

| Ferramenta | Entrada | Saída (resumo) | Fonte |
|---|---|---|---|
| `resumo_dia` | `dia` (AAAA-MM-DD) | geração, importado, exportado, consumo, autoconsumo, autossuficiência, ar, boiler, outros (kWh) | `v_house_daily` |
| `comparar_periodo` | `dia`, `dias_antes` (padrão 7) | o dia, a média dos N dias anteriores, diferença por parcela, a parcela que mais explica a diferença | `v_house_daily` |
| `creditos` | — | meses das contas (consumido, injetado, compensado, saldo), conferência entre meses, saldo atual e duração estimada | `bills` + `app/credits-months.js`; `v_credits` |
| `status_coleta` | — | por fonte: última rodada, ok, idade em minutos, diagnóstico (em dia, atrasada, falhando, pausa noturna) | `v_collector_status` |
| `buscar_documentos` | `consulta`, `colecao` opcional | até 4 trechos com título, caminho e pontuação | Weaviate |

Toda saída tem o campo `fonte`. Erro de ferramenta vira `{ erro }` e o expert pode tentar outra coisa.

### 4.2 Experts

| Expert | Ferramentas | Coleções |
|---|---|---|
| `consumo` | `resumo_dia`, `comparar_periodo`, `buscar_documentos` | `ResumoDiario`, `ProjetoDocs` |
| `creditos` | `creditos`, `resumo_dia`, `buscar_documentos` | `RegrasEnergia`, `Contas`, `ProjetoDocs` |
| `operacao` | `status_coleta`, `buscar_documentos` | `ProjetoDocs` |

Prompt de sistema de cada expert: papel, data de hoje (America/Sao_Paulo), regras do sistema que ele precisa,
"todo número vem de ferramenta", "se faltar dado, diga que falta", formato (resposta curta e uma linha
`Fontes:` com ferramentas e caminhos de documento).

### 4.3 RAG

- Corte de Markdown por títulos (`#`, `##`, `###`), trechos de até 1.200 caracteres com sobreposição de uma frase,
  cada trecho com `titulo`, `caminho` e `colecao`.
- `ProjetoDocs`: spec, planos, auditoria de segurança, READMEs.
- `RegrasEnergia`: `agent/knowledge/regras-energia.md`, um resumo próprio das regras de compensação
  (micro e minigeração distribuída) e do glossário da fatura, com as regras específicas deste sistema.
- `Contas`: as 5 contas de `app/tests/fixtures/`, lidas por `app/billparse.js` e escritas em texto.
- `ResumoDiario`: um texto por dia do período, gerado pelo `DataProvider`.
- Fusão híbrida no store em memória: `alpha·cos_norm + (1−alpha)·bm25_norm`, normalização min-max por consulta,
  igual em espírito ao `relativeScoreFusion` do Weaviate.

### 4.4 Observabilidade

Um registro por pergunta: `id`, horário, pergunta, expert, motivo do roteamento, se usou a reserva, cada passo
(ferramenta, argumentos, duração, ok/erro, tamanho da saída), trechos recuperados (coleção, caminho, pontuação),
tokens de entrada e saída (de `usage_metadata`), latência total e a checagem de números. Arquivo JSONL em
`agent/logs/` (ignorado pelo Git); a avaliação grava uma amostra versionada em `agent/eval/results/`.

### 4.5 Avaliação

`agent/eval/dataset.json`: perguntas com expert esperado, ferramentas esperadas, números esperados na resposta
e documento esperado no RAG. Critérios por pergunta: roteamento, ferramentas, números, sem número sem fonte,
documento recuperado. `npm run eval:offline` usa o modelo roteirizado (prova o encanamento, roda no CI);
`npm run eval` usa o Gemini de verdade (precisa de `GEMINI_API_KEY`).

## 5. Segurança e privacidade

- `GEMINI_API_KEY` só em `agent/.env` (o `.gitignore` da raiz já ignora `.env*`). O `.claude/settings.json`
  nega a leitura de `.env*` pelo Claude Code.
- Laboratório com dados simulados. Nenhum dado real da casa vai para o Gemini.
- O papel do Postgres do laboratório é o dono do banco local; o assistente só faz `select`.
- Os documentos do RAG são do repositório, que já não tem segredos (`app/tests/security.test.mjs` e a
  auditoria de 22/11).

## 6. Testes

`node --test` com modelo roteirizado (`src/scripted-model.ts`), store em memória e fonte `demo`. Cobrem: cada
ferramenta (valores conferidos contra o `app/demo.js` e o `app/credits-months.js`), corte e busca híbrida,
roteador (LLM e reserva), loop do expert (chamada de ferramenta, erro de ferramenta, limite de passos),
checagem de números, registro e a fonte `postgres` contra o Postgres local com o seed (quando houver
`DATABASE_URL`).

## 7. Fora de escopo agora

Interface no PWA, LangSmith, Grafana, servidor HTTP, memória de conversa entre perguntas.
