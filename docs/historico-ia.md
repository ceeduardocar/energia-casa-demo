# Histórico de uso de IA

Registro de como a IA foi usada no Energia Casa: o que foi pedido, o que o agente fez, o que deu errado e como
foi corrigido. Complementa o histórico do Git (commits com `Co-Authored-By: Claude` e `Claude-Session:`) e o
`docs/capstone-4.md` (seções 2 e 4, PR #5).

Ferramentas usadas:
- **Claude Code** como agente de código, com as skills `superpowers` (brainstorming, writing-plans,
  executing-plans, test-driven-development).
- **Codex** (ChatGPT) como revisor automático dos pull requests no GitHub.
- **Gemini**, pelo LangChain.js, como o LLM do próprio assistente de energia (`agent/`).

## 1. Linha do tempo

| Data | Objetivo | Artefato antes do código | Resultado |
|---|---|---|---|
| 08/10/2026 | banco e views de cálculo | spec `docs/superpowers/specs/2026-10-08-energia-casa-design.md`, plano 1 | migrations e 15 suítes SQL |
| 09/10/2026 | coletor Solarman | plano 2; `scripts/solarman-check.mjs` rodado contra a API real antes do cliente | coletor no ar às 06:51 do mesmo dia |
| 12/10/2026 | coletor Tuya | plano 3; `scripts/tuya-check.mjs` | coleta 24 h |
| 12/10 a 20/10/2026 | corrigir números que não fechavam com a conta | auditoria contra os marcos da Neoenergia (migrations `20261013*`) | rede pela potência integrada (`capstone-4.md` §4.1) |
| 21/10/2026 | desempenho das views | medição antes e depois | `v_now` de 400 para 0,5 ms |
| 22/11/2026 | segurança do Supabase e do app | auditoria `docs/2026-11-22-isolamento-seguranca-supabase.md` | PRs #2 e #3 |
| 23/11/2026 | passos 1 a 3 do Capstone: CI, `.claude/`, assistente | plano de entrega (PR #4), spec e plano 4 do assistente | PR #6 |
| 23/11/2026 | passos 4 a 6: refatoração, observabilidade, histórico | este documento | PR #6 |

## 2. Sessão de 23/11/2026: CI, `.claude/` e assistente (PR #6)

### 2.1 Pedido

> "faça os passos 1, 2 e 3... para o passo 3, posso usar o Gemini?"

Os passos vêm do plano de entrega (`docs/plano-entrega-pos-ia.md`, seção 6). A resposta foi sim: o Gemini entra
pelo `@langchain/google-genai`, e a escolha virou a decisão D1 da spec.

### 2.2 Como o agente trabalhou

1. **Leu o estado antes de mudar.** Rodou as três suítes no `master`. App e coletor passaram. A suíte SQL falhou
   em `schema "auth" does not exist`, e o agente viu que o PR #3 corrige isso. Por isso o PR #6 foi
   empilhado no PR #3, e não aberto direto contra o `master`.
2. **Spec antes do código.** `docs/superpowers/specs/2026-11-23-assistente-design.md` registra 12 decisões,
   cada uma com as alternativas recusadas e o motivo. Exemplos:
   - D5: loop de ferramentas próprio, em vez do `createAgent` do LangGraph, para registrar cada passo e testar
     sem depender dos internals do LangGraph;
   - D2: vetores calculados no cliente, em vez de um módulo `text2vec` dentro do Weaviate.
3. **Teste junto de cada peça.** Cada ferramenta foi conferida contra o código que já existia:
   - `resumo_dia` contra o `app/demo.js`;
   - `creditos` contra o `app/credits-months.js`, com a conta de 09/2026 dando 212 kWh compensados.
4. **Avaliação como teste de integração.** O dataset de 10 perguntas roda no CI com um modelo roteirizado
   (`npm run eval:offline`).
5. **Revisão externa.** O Codex revisou o PR e achou dois erros reais (seção 2.4).

### 2.3 Escolhas feitas pelo agente e por quê

| Escolha | Motivo |
|---|---|
| Versões de dependência com pelo menos duas semanas (`@langchain/core` 1.3.5, não a 1.5.0 de 3 dias) | reduzir o risco de pacote recém-publicado comprometido |
| `CLAUDE.md` fora do índice do RAG | tem identificadores da planta e da conta; as regras dele foram resumidas em `agent/knowledge/regras-energia.md` |
| Laboratório só em `127.0.0.1`, e `prepare-db.sh` recusa banco com `readings` | o mesmo cuidado de `scripts/test-db.sh` contra rodar num banco real |
| `.claude/settings.json` com "perguntar" (e não "negar") para `git push origin master` | negar travaria a publicação que o próprio Cesar pede; perguntar mantém o controle |
| Números só de ferramentas, e checagem de números na resposta | o critério "código correto" vale também para o que o LLM diz |

### 2.4 Erros e correções

| O que aconteceu | Como foi achado | Correção |
|---|---|---|
| O modelo roteirizado não funcionava com `withStructuredOutput`: `Input is not an AIMessageChunk` | teste do roteador | leitura do código do `@langchain/core` 1.3.5: a saída estruturada padrão só aceita `AIMessageChunk`; o modelo passou a devolver chunk (`src/scripted-model.ts`) |
| Teste do dia da semana esperava `qui`, mas o app devolve `Qui` | teste | o teste passou a usar o formato do app, sem mudar o app |
| A política offline escolhia agosto na pergunta "setembro bate com o de agosto?" | avaliação offline (8 de 9) | o mês da conta passou a ser o primeiro citado no texto, e não o primeiro da lista de meses |
| Na mesma política, uma conta com saldo negativo virava "sobraram -55 kWh" | leitura da resposta da avaliação | texto separado para crédito antigo usado |
| Checagem de números: "2.038,67" escrito numa fonte virava 2038 e 67 | **revisão do Codex** no PR #6 | o mesmo corte de milhar para a fonte e para a resposta, com teste |
| Checagem de números: "1950 kWh" passava quando a ferramenta dizia 19,5 (a fração virava porcentagem sem "%") | **revisão do Codex** no PR #6 | a conversão só vale com "%", com teste |
| `npm run eval` saía sem imprimir nada no Windows | Cesar rodou no PowerShell, num caminho com espaços | a checagem de módulo principal comparava `import.meta.url` com `"file://" + argv[1]`; passou a usar `pathToFileURL` (PR #7) |
| Primeira avaliação com o Gemini: 0 de 10, todas com erro | saída do Cesar e o erro 404 do Google | o `gemini-2.5-flash` deixou de aceitar chaves novas; padrão trocado para `gemini-3.8-flash`. A avaliação passou a mostrar o erro de cada pergunta, e o resumo por critério deixou de contar `expert` e `ferramentas` sempre como certos (o nome usado sobrescrevia o critério) |
| Weaviate não rodou no ambiente do agente: download da imagem recusado e o binário bloqueado | tentativa | o teste de integração roda só com `WEAVIATE_HOST`; o CI sobe o Weaviate e o teste passou lá (43 de 43) |

Os dois erros apontados pelo Codex mostram por que a checagem de números precisava de revisão de fora. O próprio
autor da checagem (o agente) não tinha pensado nos casos de milhar em texto nem de porcentagem sem símbolo.

### 2.5 Passos 4 a 6, na mesma tarde

Pedido: aproveitar a última hora de créditos com os passos 4 (refatoração), 5 (observabilidade) e 6 (documentação).
O agente priorizou o que o avaliador lê no repositório e enviou um commit por passo, para não perder trabalho.

| Passo | Entrega | Verificação |
|---|---|---|
| 6 | este documento; mapa requisito → arquivo no `README.md` | revisão de leitura |
| 5 | `npm run report` (`agent/src/obs/report.ts`), amostra em `agent/obs-amostra/` | `agent/tests/report.test.ts` |
| 4 | `agent/src/format.ts`: arredondamento e formato pt-BR que estavam copiados em 4 arquivos | `agent/tests/format.test.ts` escrito antes; todos os testes e a avaliação offline iguais depois |
| extra | painel Grafana no laboratório (`agent/lab/grafana/`) lendo `obs.perguntas` | as 8 consultas do painel rodadas contra o Postgres local com a amostra; `agent/tests/pg-export.test.ts`. O Grafana não subiu no ambiente do agente (imagens Docker bloqueadas) |

## 3. O que o autor decidiu e o que ficou com a IA

| Decisão | Quem |
|---|---|
| Não mexer na produção pela pós; laboratório com dados simulados | Cesar |
| LLM do assistente: Gemini | Cesar |
| Ordem dos passos e conjunto mínimo do enunciado | plano de entrega, aprovado pelo Cesar |
| Arquitetura do assistente (experts, ferramentas, RAG, checagem) | agente, registrada na spec |
| Merge dos PRs e publicação no `master` | Cesar |
| Chave do Gemini e avaliação com o LLM real | Cesar (a chave nunca passa pelo chat) |

## 4. Como reproduzir

```bash
node --test app/tests/*.test.mjs                               # app
node --test "supabase/functions/collect/tests/*.test.ts"        # coletor
url=$(scripts/local-pg.sh start); DATABASE_URL="$url" scripts/test-db.sh; scripts/local-pg.sh stop   # SQL
cd agent && npm ci && npm test && npm run eval:offline          # assistente
```

O mesmo roda no CI (`.github/workflows/ci.yml`) em cada PR.
