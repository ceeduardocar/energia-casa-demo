# Assistente de energia (LangChain.js + Gemini + RAG no Weaviate)

Responde em português perguntas sobre a energia da casa, com números conferidos e a fonte de cada um.
Roda num laboratório local, com dados simulados. Não toca o Supabase de produção, o coletor nem o PWA.

Spec: [`docs/superpowers/specs/2026-11-23-assistente-design.md`](../docs/superpowers/specs/2026-11-23-assistente-design.md).
Plano: [`docs/superpowers/plans/2026-11-23-energia-casa-plano-4-assistente.md`](../docs/superpowers/plans/2026-11-23-energia-casa-plano-4-assistente.md).

```
$ node src/cli.ts --offline "Por que a conta de setembro veio com 100 kWh se eu injetei mais do que consumi?"
Na conta de 2026-09 a casa consumiu 312 kWh e injetou 312 kWh.
O mínimo faturado de 100 kWh não sai dos créditos: foram compensados 212 kWh, e sobraram 100 kWh para o saldo.
Fontes: creditos, agent/knowledge/regras-energia.md

— expert creditos · ferramentas: creditos, buscar_documentos · números conferidos (7) · 25 ms · 300+60 tokens
```

Saída do modo `--offline` (modelo roteirizado, sem chave). Com o Gemini a redação muda; os números e as fontes
vêm das mesmas ferramentas.

## Como funciona

```
pergunta
  └─ roteador (Gemini, saída estruturada; reserva por palavras-chave)      src/router.ts
       └─ expert: consumo | creditos | operacao                              src/experts/
            ├─ ferramentas de dados (números de código testado)              src/tools/
            │     resumo_dia · comparar_periodo · creditos · status_coleta
            │     └─ DataProvider: demo (app/demo.js) | postgres (laboratório) src/data/
            └─ buscar_documentos: RAG híbrido (vetor + BM25)                 src/tools/buscar.ts
                  └─ VectorStore: memory | weaviate                          src/rag/
                        ProjetoDocs · RegrasEnergia · Contas · ResumoDiario
       └─ checagem de números da resposta                                    src/grounding.ts
  └─ registro JSON da pergunta (agent/logs/)                                 src/obs/log.ts
```

- **Números vêm de ferramentas.** O LLM escolhe a ferramenta e redige. Crédito mês a mês usa a mesma função do app
  (`app/credits-months.js`); o dia usa `v_house_daily`. Toda saída de ferramenta tem o campo `fonte`.
- **Checagem de números.** Cada número da resposta precisa aparecer na pergunta ou nos argumentos e resultados das
  ferramentas (com tolerância de arredondamento). O que não aparece vai para `checagem.sem_fonte` no registro.
- **Experts com ferramentas limitadas.** O expert de operação não vê a ferramenta de créditos, e assim por diante
  (`src/experts/definitions.ts`). O loop tem no máximo 6 passos (`src/experts/loop.ts`).
- **RAG híbrido.** Trechos de Markdown cortados por título, com o caminho do arquivo para citar. Embeddings do Gemini
  (`gemini-embedding-001`) ou locais por hashing (`HashEmbeddings`, sem rede). No Weaviate os vetores são gravados
  pelo cliente (`selfProvided`) e a busca é `hybrid` com `alpha = 0.5`.

## Rodar

Precisa de Node 22.18 ou mais novo (TypeScript roda direto, sem build).

```bash
cd agent
npm ci
cp .env.example .env          # e coloque a GEMINI_API_KEY (https://aistudio.google.com/apikey)
npm test                      # sem rede e sem chave
npm run eval:offline          # avaliação com o modelo roteirizado, sem rede
```

Perguntar (Gemini de verdade, dados demo, índice em memória):

```bash
node src/cli.ts "Por que ontem consumi mais que a média?"
node src/cli.ts --json "A coleta da Tuya está funcionando?"     # o registro completo
node src/cli.ts --offline "Quanto o boiler gastou ontem?"        # sem chave: modelo roteirizado
```

Laboratório completo (Weaviate + Postgres com as migrations e 30 dias simulados):

```bash
docker compose -f lab/docker-compose.yml up -d
DATABASE_URL=postgresql://postgres:lab@localhost:54330/postgres lab/prepare-db.sh
export DATABASE_URL=postgresql://postgres:lab@localhost:54330/postgres
npm run ingest -- --store weaviate --data postgres --embed gemini
node src/cli.ts --store weaviate --data postgres --embed gemini "Quanto a casa consumiu ontem?"
AGENT_PG_URL=$DATABASE_URL WEAVIATE_HOST=localhost npm test    # inclui os testes de Postgres e Weaviate
docker compose -f lab/docker-compose.yml down -v
```

| Opção | Valores | Padrão |
|---|---|---|
| `--data` | `demo` (curvas do `app/demo.js`), `postgres` (laboratório, `DATABASE_URL`) | `demo` |
| `--store` | `memory` (indexa a cada execução), `weaviate` (indexa uma vez com `npm run ingest`) | `memory` |
| `--embed` | `hash` (local), `gemini` | `hash` |
| `--offline` | usa o modelo roteirizado em vez do Gemini | — |
| `--expert` | força `consumo`, `creditos` ou `operacao` | roteador |

## Avaliação

`eval/dataset.json` tem 10 perguntas com o expert, as ferramentas, os números, as palavras e o documento esperados.
Os dados são os do modo demo com "hoje" fixo em 20/11/2026, então os números esperados não mudam.

- `npm run eval:offline`: modelo roteirizado (`src/offline-policy.ts`). Prova o encanamento inteiro (roteamento,
  ferramentas, RAG, checagem e registro) e roda no CI, que falha se algum critério falhar. Não mede a qualidade
  do Gemini. A pergunta `rag-contadores-tuya` só roda com o Gemini.
- `npm run eval`: Gemini de verdade. Grava `eval/results/gemini-AAAA-MM-DD.json` com as respostas, os registros
  completos e a taxa por critério. Não falha o processo; a análise das falhas fica com o subagente
  `avaliador-assistente` (`.claude/agents/`).

Resultado versionado: [`eval/results/`](eval/results/).

## Observabilidade

Cada pergunta gera uma linha em `logs/AAAA-MM-DD.jsonl` (ignorado pelo Git) com: expert e motivo do roteamento,
se usou a reserva, cada passo (ferramenta, argumentos, duração, ok/erro, tamanho), trechos recuperados
(coleção, caminho, pontuação), tokens de entrada e saída, chamadas ao LLM, a checagem de números, a resposta e
o tempo total. A avaliação guarda os mesmos registros no arquivo de resultado.

`npm run report` resume os registros: perguntas por expert, quantas foram roteadas pela reserva, latência
(média, p50, p95, máximo), tokens, chamadas ao LLM, ferramentas (por nome e com erro), buscas e trechos do RAG
por coleção, documentos mais recuperados, números verificados e perguntas com número sem fonte. Aceita um
arquivo de log ou um resultado da avaliação; `--json` devolve as métricas para outra ferramenta.

```bash
npm run report                                        # todos os arquivos de logs/
npm run report -- obs-amostra/2026-11-23-offline.jsonl
```

Amostra versionada: [`obs-amostra/`](obs-amostra/) (os registros da avaliação offline e o relatório deles).

### Painel no Grafana (laboratório)

O `lab/docker-compose.yml` sobe um Grafana 11.6 em http://localhost:3000 (só leitura, sem login) com o painel
"Assistente de energia": perguntas, tempo médio, tokens, perguntas com número sem fonte, perguntas por expert,
tempo por pergunta, chamadas por ferramenta e as últimas perguntas. Ele lê a tabela `obs.perguntas` do Postgres
do laboratório, preenchida a partir dos registros:

```bash
export DATABASE_URL=postgresql://postgres:lab@localhost:54330/postgres
npm run obs:export                                     # todos os arquivos de logs/
npm run obs:export -- obs-amostra/2026-11-23-offline.jsonl
```

Painel e fonte de dados ficam versionados em `lab/grafana/`. As consultas do painel foram conferidas contra o
Postgres do laboratório com a amostra; o Grafana em si não rodou no ambiente onde o painel foi escrito (o
download de imagens Docker estava bloqueado), então confira na primeira subida.

## Privacidade e segurança

- A chave do Gemini fica só em `agent/.env` (ignorado). O `.claude/settings.json` nega a leitura de `.env*`.
- O que vai ao Gemini: a pergunta, os resultados das ferramentas (dados simulados) e, com `--embed gemini`, os
  trechos indexados: READMEs, specs, a auditoria de segurança, `knowledge/regras-energia.md` e as 5 contas de
  exemplo de `app/tests/fixtures/` (sem nome, CPF nem endereço). O `CLAUDE.md` não é indexado.
- O Postgres e o Weaviate do laboratório só escutam em `127.0.0.1`.
- O assistente só faz `select`. `lab/prepare-db.sh` recusa um banco que já tenha `public.readings`.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `src/tools/` | ferramentas `tool()` + zod: `dias.ts`, `creditos.ts`, `coleta.ts`, `buscar.ts` |
| `src/experts/` | definição dos experts (papel, regras, ferramentas, coleções) e o loop de ferramentas |
| `src/rag/` | corte, embeddings, store em memória e Weaviate, fontes e ingestão |
| `src/data/` | `DataProvider` demo e postgres |
| `src/scripted-model.ts` | `BaseChatModel` roteirizado para testes e avaliação offline |
| `src/format.ts` | arredondamento e números em português, usados pelas ferramentas, pelo RAG e pela política offline |
| `src/obs/` | registro por pergunta e relatório (`npm run report`) |
| `obs-amostra/` | registros e relatório de exemplo, versionados |
| `knowledge/` | regras de energia escritas para o RAG |
| `lab/` | Docker Compose (Weaviate, Postgres, Grafana), preparo do banco e painel em `lab/grafana/` |
| `eval/` | dataset, execução e resultados |
| `tests/` | `node --test`; Postgres e Weaviate só com `AGENT_PG_URL` e `WEAVIATE_HOST` |
