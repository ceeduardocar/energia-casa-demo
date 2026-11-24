# Capstone 4: AI-Augmented Application Development

Projeto: **EnergyKontrol** (repositório `energia-casa`), sistema pessoal de energia residencial.
Curso: Coders University, Pós-graduação em Engenharia de IA Aplicada, Módulo 04 (Engenharia de Software
com IA), entrega M4.CAPSTONE. Documento atualizado em 24/11/2026, com o `master` no commit `1c56f9e`.

Este documento é o ponto de entrada para quem avalia o repositório. Ele segue o enunciado: escopo,
entregáveis e critérios de aceitação. Cada afirmação aponta o arquivo, o commit ou o número que a comprova.
A seção 3 é o mapa completo de requisito para arquivo. A seção 13 diz o que ficou de fora e por quê.

Nesta cópia pública, os hashes de commit e os números de PR citados (por exemplo `594efd6` ou PR #6) se referem
ao repositório privado original. A cópia foi criada sem histórico, então eles não abrem aqui; os arquivos citados
estão todos presentes.

Para avaliar sem credenciais:

- **App em modo demonstração:** https://energia-casa-demo.vercel.app (dados de exemplo, sem login).
- **Cópia pública do código:** este repositório (mesmo código do privado, com identificadores da casa
  trocados por valores de exemplo).
- **Roteiro de 10 minutos:** seção 14.

O enunciado permite usar um problema real e não exige produção. Este projeto é um problema real e já roda em
produção desde 09/10/2026. O assistente de IA (agentes experts e RAG) roda num laboratório local com dados
simulados e não toca a produção.

Arquivos que não precisam ser lidos: `app/vendor/` (supabase-js e pdf.js de terceiros, minificados),
`app/fonts/`, `app/icons/` e `agent/package-lock.json`.

## 1. O projeto em uma página

O problema: a casa tem geração solar, um medidor de rede bidirecional e medidores por aparelho. Cada fonte de
dados fica num aplicativo diferente, e nenhum deles fecha a conta com a distribuidora (Neoenergia). O sistema
junta tudo num app de celular: o agora, o histórico, o consumo por aparelho e o saldo de créditos de energia.
Ele também confere a conta de luz contra o medido em casa. Um assistente responde perguntas em português
sobre esses números, com a fonte de cada um.

```
Solarman (2 microinversores Deye) ─┐
Tuya (medidor de rede + 2 canais) ─┼─► Edge Function collect (Deno, a cada 5 min, pg_cron)
                                   │        │
                                   │        ▼
                                   │   Supabase Postgres 17
                                   │   readings ─gatilho─► energy_hourly ─► views (v_house_*, v_grid_*, v_credits)
                                   │                                         get_home(dia)
                                   │        ▲ RLS + usuário autorizado
                                   │        │
                                   └──  PWA estático (app/, sem build, Vercel)
                                        lê a conta da Neoenergia em PDF no próprio aparelho (billparse.js)

Laboratório local (agent/, dados simulados):
  pergunta ─► roteador ─► expert (consumo | créditos | operação) ─► ferramentas (números do código testado)
                                                                └─► RAG híbrido no Weaviate (documentos)
            ─► checagem de números da resposta ─► registro JSON por pergunta ─► relatório e Grafana
```

| Parte | Onde | Tamanho |
|---|---|---|
| Banco: tabelas, views, funções, RLS | `supabase/migrations/` | 20 migrations |
| Coletor (Solarman e Tuya, ao vivo e histórico) | `supabase/functions/collect/` | 9 módulos TypeScript |
| App PWA | `app/` | 16 módulos JS, sem framework e sem build |
| Assistente (LangChain.js + Gemini + Weaviate) | `agent/` | roteador, 3 experts, 5 ferramentas, RAG, avaliação, observabilidade |
| Skills, comandos e subagentes do projeto | `.claude/` | 4 comandos, 2 skills, 3 subagentes |
| Testes e CI | `app/tests/`, `supabase/functions/collect/tests/`, `supabase/tests/`, `agent/tests/`, `.github/workflows/ci.yml` | seção 6 |
| Especificações e planos | `docs/superpowers/` | 2 specs, 4 planos |
| Histórico de uso de IA | `docs/historico-ia.md` | seção 2 |

## 2. Uso de IA no ciclo completo e spec-driven development

O desenvolvimento foi conduzido com o **Claude Code** como agente de código. O autor decidiu o que fazer,
revisou e testou. O agente escreveu a maior parte do código, dos testes e da documentação. O **Codex**
revisou pull requests no GitHub, e o **Gemini** é o LLM do próprio assistente.

Evidências no histórico do Git:

- **36 dos 50 commits** do `master` têm a linha `Co-Authored-By: Claude`
  (`git log --format=%b | grep -c "Co-Authored-By: Claude"`).
- Vários commits citam a sessão do agente que os gerou (linhas `Claude-Session:`). Essas sessões são
  privadas; o que elas continham está resumido em `docs/historico-ia.md`.
- Foram usados modelos diferentes por tipo de tarefa, todos registrados nos commits. Um modelo mais leve
  ficou com tarefas mecânicas, por exemplo `ec1f870` (mapa Tuya) e `e0d5835` (agenda do cron). Os modelos
  maiores ficaram com o desenho e a lógica, por exemplo `b6c3c11` (cliente Solarman e backfill).

O fluxo é **spec-driven development**: nenhum código foi escrito antes de existir uma especificação e um
plano aprovados. Foram quatro etapas, sempre com um artefato versionado entre elas:

1. **Ideia para especificação.** Duas specs, escritas com o agente na pasta padrão das skills superpowers:
   - `docs/superpowers/specs/2026-10-08-energia-casa-design.md` (o sistema: objetivo, fora de escopo,
     modelo de dados, fontes e critério de sucesso);
   - `docs/superpowers/specs/2026-11-23-assistente-design.md` (o assistente: 12 decisões, cada uma com as
     alternativas recusadas e o motivo).
2. **Especificação para plano.** Um plano por fase, no formato da skill `superpowers:writing-plans`:
   - `docs/superpowers/plans/2026-10-08-energia-casa-plano-1-banco.md`
   - `docs/superpowers/plans/2026-10-09-energia-casa-plano-2-coletor-solarman.md`
   - `docs/superpowers/plans/2026-10-12-energia-casa-plano-3-coletor-tuya.md`
   - `docs/superpowers/plans/2026-11-23-energia-casa-plano-4-assistente.md`

   Cada plano tem tarefas pequenas com checkbox, arquivos a tocar e testes esperados. O cabeçalho manda o
   agente executar com `superpowers:subagent-driven-development` ou `superpowers:executing-plans`.
3. **Plano para código.** A execução foi tarefa a tarefa. Nos planos 1, 3 e 4, cada tarefa começa pelo
   teste e tem o passo "Rodar e ver falhar" antes da implementação. Cada tarefa virou um commit pequeno,
   como se vê na sequência `4db482b` a `1577651` (plano 2).
4. **Código para memória do projeto.** O `CLAUDE.md` guarda o estado, as decisões, as convenções e as regras
   que o agente deve seguir em toda sessão. Exemplos de regras: nunca colar segredos, coletor somente
   leitura, separação total entre este projeto e outro projeto do autor.

O `CLAUDE.md` funciona como memória de longo prazo. Sem ele, cada sessão nova começaria do zero. Com ele, o
agente sabe que publicar é `git push origin master`, que `APP_VERSION` precisa subir a cada mudança no app e
por que a energia da rede usa a potência integrada em vez dos contadores (seção 4.1). As regras que se
repetem viraram skills, comandos e subagentes versionados em `.claude/` (seção 11).

Um ponto importante: **o agente trabalhou com dados reais e APIs reais.** Antes de escrever o cliente
Solarman, ele rodou `scripts/solarman-check.mjs` contra a API e registrou no plano 2 o que a API devolveu de
verdade, inclusive os formatos de erro. Os testes usam esses formatos. O script `scripts/tuya-check.mjs` fez
o mesmo para a Tuya.

**Histórico de uso de IA.** `docs/historico-ia.md` registra, por sessão, o pedido, como o agente trabalhou,
as escolhas que ele fez e por quê, os erros e as correções, e o que ficou com o autor e o que ficou com a
IA. Destaques:

- a linha do tempo do projeto, de 08/10 a 23/11/2026, com o artefato que veio antes de cada código (§1);
- a tabela de erros do código gerado e como cada um foi achado: por teste, pela avaliação, pela revisão do
  Codex ou pelo autor rodando no Windows (§2.4);
- a divisão de decisões: produção fora da pós, escolha do Gemini e merges ficaram com o autor; a arquitetura
  do assistente ficou com o agente, registrada na spec (§3).

## 3. Enunciado e evidência no repositório

### 3.1 Escopo

| Item do escopo | Situação | Evidência |
|---|---|---|
| Funcionalidade real | Feito | seção 1; em produção desde 09/10/2026, coleta a cada 5 min; demo pública sem login |
| Código gerado com IA | Feito | seção 2; 36 dos 50 commits co-autorados pelo agente; `docs/historico-ia.md` |
| Spec-driven development | Feito | seção 2; `docs/superpowers/specs/` (2 specs) e `docs/superpowers/plans/` (4 planos) |
| Testes automatizados | Feito | seção 6; 4 suítes, todas no CI (`.github/workflows/ci.yml`) |
| Refatoração aplicada | Feito | seção 5; views rápidas (`594efd6`) e `agent/src/format.ts` |
| Observabilidade | Feito | seção 10; `agent/src/obs/`, `npm run report`, painel Grafana em `agent/lab/grafana/` |
| Skills, comandos e agentes customizados | Feito | seção 11; `.claude/commands/`, `.claude/skills/`, `.claude/agents/` |
| Agentes experts com LangChain.js | Feito | seção 8; `agent/src/router.ts`, `agent/src/experts/`, `agent/src/tools/` |
| RAG com busca vetorial no Weaviate | Feito, com ressalva | seção 8.3; `agent/src/rag/weaviate.ts`; testado contra um Weaviate real no CI. A avaliação com o Gemini usou o índice em memória (seção 9) |

### 3.2 Entregáveis

| Entregável | Situação | Onde |
|---|---|---|
| Aplicação funcional | Feito | `app/`, `supabase/`, `agent/`; demo em https://energia-casa-demo.vercel.app |
| Código completo | Feito | seção 1; cópia pública em https://github.com/ceeduardocar/energia-casa-demo |
| Testes | Feito | seção 6 |
| Documentação | Feito | este documento, `README.md` (mapa curto), `app/README.md`, `agent/README.md`, `docs/` |
| Histórico de uso de IA | Feito | `docs/historico-ia.md` e o histórico do Git (seção 2) |

### 3.3 Critérios de aceitação

| Critério | Como o projeto atende | Seção |
|---|---|---|
| Técnica: aplicação funcional | em uso diário; modo demonstração para avaliar sem credenciais | 1, 14 |
| Técnica: código correto | números conferidos contra a conta da distribuidora; testes com casos reais; o assistente só usa números de ferramentas testadas e a resposta passa por uma checagem de números | 4, 6, 8 |
| Engenharia: organização do código | camadas separadas: coleta, banco, app, assistente | 7 |
| Engenharia: modularidade | lógica pura com dependências injetadas; `DataProvider` e `VectorStore` trocáveis no assistente | 7, 8 |
| Qualidade: testes implementados | quatro suítes sem rede e sem segredo, no CI em cada PR; avaliação do assistente com 10 perguntas | 6, 9 |
| Qualidade: código limpo | módulos pequenos com comentário de propósito; duplicação removida (`format.ts`); convenções no `CLAUDE.md` e em `.claude/skills/convencoes-energia/` | 5, 7 |
| Uso de IA: uso estratégico | spec e plano antes do código; modelo por tipo de tarefa; `CLAUDE.md` como memória; skills e subagentes próprios; revisão cruzada pelo Codex | 2, 11 |
| Uso de IA: entendimento do que foi gerado | erros do código gerado achados e corrigidos com dados reais; erros do assistente registrados com a causa | 4, `docs/historico-ia.md` §2.4 |

## 4. Entendimento do que foi gerado: estudos de caso de debug

Os quatro casos abaixo mostram erros que passaram pelo código e pelos testes e foram achados com dados reais.
Cada um foi entendido, corrigido e coberto por um teste ou por uma auditoria.

### 4.1 Exportação inflada em 30% pelos contadores da Tuya

- **Sintoma.** O saldo de créditos do app não fechava com a conta da Neoenergia. De 15/10 a 20/10, os
  contadores do medidor Tuya somaram 62,0 kWh importados e 60,9 exportados. A Neoenergia mediu 55 e 46.
  O saldo líquido ficou em +1,1 kWh contra +9 kWh da distribuidora.
- **Investigação.** Foi criada uma auditoria que compara a rede líquida com os marcos de leitura da Neo
  (`20261013000100_grid_net_audit.sql`, commit `d56526a`). Ela ganhou uma medida de cobertura, para separar
  falta de leitura de erro de medida (`20261013000200_grid_audit_coverage.sql`, commit `7ed5457`). Depois a energia foi recalculada integrando a
  potência assinada a cada 5 minutos. Resultado: 53,7 importados e 47,0 exportados, perto da Neoenergia.
- **Correção.** As views da casa e dos créditos passaram a usar a potência integrada. Lacunas de até 60
  minutos são interpoladas, e os contadores ficam só como fallback
  (`20261020000100_house_use_net_grid.sql`, commit `5288b44`).
- **Lição.** O dado "oficial" do fabricante estava errado. Só a comparação com uma terceira fonte revelou o
  problema. O agente montou a auditoria e as consultas de comparação em SQL.

### 4.2 Créditos subestimados em até 100 kWh por ciclo

- **Sintoma.** O saldo calculado divergia do saldo impresso na conta.
- **Causa.** A leitura das contas de 08/2026 e 09/2026 mostrou que a Neoenergia fatura no mínimo 100 kWh por
  ciclo. Esse mínimo é o custo de disponibilidade, e ele não sai dos créditos.
- **Correção.** A regra virou
  `saldo = base + injetado - max(importado - 100, 0)`, por ciclo de leitura (commit `70c3126`, migration
  `20261009000400_credits_min_billed.sql`). O teste `supabase/tests/04_credits_boiler.test.sql` reproduz
  a conta de 09/2026.

### 4.3 Coleta da Tuya quebrando só em produção

- **Sintoma.** Os testes locais passavam, mas a coleta falhava no Supabase Edge Runtime.
- **Causa.** O cliente mandava corpo vazio num `GET`, e o runtime do Deno recusa isso.
- **Correção.** O commit `65e479f` tirou o corpo do GET. O dublê de rede dos testes passou a recusar o mesmo
  caso, para o erro nunca mais passar despercebido (`supabase/functions/collect/tests/fakes.ts`).
  Lição: o dublê de teste tem de imitar também as restrições do ambiente real.

### 4.4 Direção da rede trocando de sinal

- **Sintoma.** O cartão "Agora" às vezes mostrava a casa injetando quando ela puxava da rede.
- **Correção.** Houve duas iterações: o commit `1f887d2` (migration `20261012000100_grid_signed_power.sql`)
  e o commit `be9f2ca`. Ficou definido que o contador com timestamp mais recente dá o sentido. Com timestamps
  iguais, o coletor não grava sinal. A convenção está no `CLAUDE.md`.
- **No app**, o cartão passou a mostrar consumo "—" com o motivo quando as leituras não fecham, em vez de um
  número errado. Os casos estão em `app/tests/agora.test.mjs`, inclusive um caso real tirado de um print do app.

### 4.5 Erros do código do assistente

O mesmo cuidado valeu para o assistente. A tabela completa está em `docs/historico-ia.md` §2.4. Três exemplos:

- **Checagem de números enganada por milhar.** "2.038,67" escrito numa fonte virava os números 2038 e 67, e
  "1950 kWh" passava quando a ferramenta dizia 19,5 (a fração virava porcentagem sem "%"). Os dois casos
  foram apontados pela revisão do Codex no PR #6 e viraram testes em `agent/tests/grounding.test.ts`.
- **Primeira avaliação com o Gemini: 0 de 10.** O modelo padrão deixou de aceitar chaves novas (erro 404 do
  Google). O padrão passou a `gemini-3.8-flash`, a avaliação passou a mostrar o erro de cada pergunta, e o
  resumo por critério deixou de contar `expert` e `ferramentas` sempre como certos (PR #8).
- **`npm run eval` mudo no Windows.** A checagem de módulo principal comparava `import.meta.url` com
  `"file://" + argv[1]` e falhava num caminho com espaços. Passou a usar `pathToFileURL` (PR #7).

## 5. Refatoração assistida

**Primeira refatoração, no banco: desempenho das views.**

- **Antes.** `v_energy_deltas` recalculava funções de janela sobre todo o histórico a cada consulta, entre
  0,4 e 4,9 s. O app abria devagar e o problema crescia com o tempo.
- **Depois** (commit `594efd6`, migrations `20261021000100_fast_views.sql` e `20261021000200_get_home.sql`):
  - a tabela `energy_hourly` guarda o kWh por série e hora;
  - um gatilho em `readings` mantém essa tabela em insert, backfill, delete e truncate;
  - em caso de erro, o gatilho só avisa, para a coleta nunca falhar;
  - `rebuild_energy_hourly()` refaz tudo;
  - `get_home(dia)` entrega a tela Início numa chamada só.
- **Medido no banco.**

  | Consulta | Antes | Depois |
  |---|---|---|
  | `v_now` | 400 ms | 0,5 ms |
  | `v_house_hourly` | 500 ms | 32 ms |
  | `v_house_daily` | 625 ms | 25 ms |
  | `v_credits` | 647 ms | 35 ms |

- **Proteção.** A refatoração mudou a forma de calcular, mas não os resultados. Os testes SQL de views
  (`02_energy_views`, `03_house_views`, `04_credits_boiler`) continuaram valendo como contrato.
- **No app**, no mesmo ciclo: abertura pelo cache do service worker, última resposta do dia guardada e
  atualização logo em seguida (`app/tests/home-cache.test.mjs`).

**Segunda refatoração, no assistente** (`agent/src/format.ts`). O arredondamento e o formato de número em
português estavam copiados em quatro arquivos (ferramentas, RAG e política offline). O teste
`agent/tests/format.test.ts` foi escrito antes; depois as cópias foram trocadas pelo módulo único, e todos os
testes e a avaliação offline deram o mesmo resultado de antes.

## 6. Testes

Quatro suítes, todas sem rede externa e sem segredo. O CI (`.github/workflows/ci.yml`) roda as quatro em cada
pull request e em cada push no `master`, cada uma num job próprio. A última rodada no `master` (commit
`1c56f9e`, 24/11/2026) passou nos quatro jobs.

| Suíte | Onde | Como rodar | Resultado |
|---|---|---|---|
| App | `app/tests/` (8 arquivos) | `node --test app/tests/*.test.mjs` | 53 de 53 |
| Coletor | `supabase/functions/collect/tests/` (8 arquivos) | `node --test "supabase/functions/collect/tests/*.test.ts"` | 66 de 66 |
| Banco | `supabase/tests/` (15 arquivos, cerca de 270 asserções) | `README.md`, seção "Rodar os testes" | 15 de 15 suítes, Postgres 17 no CI |
| Assistente | `agent/tests/` (13 arquivos) | `cd agent && npm ci && npm test` | 53 de 53 no CI; 3 deles só rodam com Postgres e Weaviate (`AGENT_PG_URL`, `WEAVIATE_HOST`) |
| Avaliação offline | `agent/eval/` | `cd agent && npm run eval:offline` | 9 de 9 perguntas, todos os critérios (seção 9) |

Como os testes foram desenhados:

- **Banco.** Cada `*.test.sql` abre uma transação, insere dados, verifica com `test.eq`, `test.ok`,
  `test.throws` e termina com `rollback`. `scripts/test-db.sh` recusa rodar num banco que já tenha
  `readings`, como proteção contra o banco real. O schema `auth` do Supabase é simulado em
  `supabase/tests/_bootstrap.sql`, e `05_security.test.sql` confere que o papel anônimo recebe
  "permission denied" e que um usuário fora da lista autorizada não vê nada.
- **Coletor.** A lógica é TypeScript puro que recebe `fetch` e o banco por parâmetro. Assim os testes usam
  dublês (`fakes.ts`) e respostas gravadas da API real (`fixtures/tuya-shadow.json`). Só o `index.ts`
  conhece o Deno.
- **App.** Os testes cobrem regras de cálculo (`util.js`, `agora`, créditos por mês), o leitor de conta em PDF
  com fixtures sem dados pessoais (`billparse.test.mjs`) e as regras de segurança (`security.test.mjs`).
- **Assistente.** As ferramentas são conferidas contra o código que já existia: `resumo_dia` contra o
  `app/demo.js`, `creditos` contra o `app/credits-months.js` (a conta de 09/2026 dá 212 kWh compensados). O
  roteador, o loop de ferramentas e a checagem de números rodam com um modelo roteirizado
  (`src/scripted-model.ts`), sem rede. No CI, o mesmo job sobe um Postgres com as migrations e 30 dias
  simulados e um Weaviate 1.32 de verdade, e os testes de integração rodam contra eles.

## 7. Organização, modularidade e código limpo

O sistema tem quatro camadas, e cada uma conhece só a vizinha:

| Camada | Responsabilidade | Não faz |
|---|---|---|
| Coletor (`supabase/functions/collect/`) | buscar dados nas APIs e gravar leituras brutas | nenhum cálculo de energia |
| Banco (`supabase/migrations/`) | toda a regra de negócio: energia por hora e dia, rede, créditos, conferência da conta | nada de rede externa |
| App (`app/`) | exibir e importar a conta em PDF | recalcular o que o banco já entrega |
| Assistente (`agent/`) | rotear a pergunta, chamar ferramentas, buscar documentos e redigir | inventar número: todo número vem de uma ferramenta |

**Coletor.** Cada módulo tem um papel:

- `solarman.ts` e `tuya.ts` são os clientes das APIs;
- `live.ts` e `tuya_live.ts` fazem a coleta ao vivo;
- `backfill.ts` importa o histórico;
- `run.ts` orquestra as fontes, cada uma com tempo limite próprio;
- `time.ts` cuida do fuso e da janela diurna;
- `types.ts` define os contratos;
- só `index.ts` conhece o Deno e o `supabase-js`.

Os outros módulos recebem `fetch` e o banco por parâmetro. Por isso os testes rodam no Node, sem rede, com
dublês (`tests/fakes.ts`). Uma fonte que falha não derruba a outra (`run.ts`).

**Banco.** A regra de negócio fica em views SQL versionadas por migration, uma por mudança, com data no nome.
A tela Início é servida por uma função (`get_home`). O app não duplica a regra.

**App.** São 16 módulos sem framework e sem build. As regras de exibição ficam em funções puras e testadas
(`util.js`, `credits-months.js`, `billparse.js`). O maior arquivo, `app.js`, tem 377 linhas.

**Convenções.** Todos os módulos do coletor e a maioria dos módulos do app abrem com um comentário que diz
para que servem. Nos nomes do banco, `v_` marca as views e o sufixo dá a unidade (`avg_power_w`,
`generation_kwh`). As decisões e convenções estão no `CLAUDE.md`, e o agente
as segue em toda sessão.

**Assistente.** Cada pasta de `agent/src/` tem um papel: `tools/` (ferramentas), `experts/` (definição dos
experts e o loop), `rag/` (corte, embeddings, stores e ingestão), `data/` (fontes de dados), `obs/` (registro
e relatório). Duas interfaces deixam o assistente testável sem infraestrutura: `DataProvider` (`demo`, que lê
as curvas do `app/demo.js`, ou `postgres`, o laboratório) e `VectorStore` (`memory` ou `weaviate`). O
assistente tem cerca de 1.400 linhas de TypeScript, que o Node 22 roda direto, sem build.

## 8. Assistente: agentes experts com LangChain.js e RAG no Weaviate

Spec: `docs/superpowers/specs/2026-11-23-assistente-design.md`. Plano: `docs/superpowers/plans/2026-11-23-energia-casa-plano-4-assistente.md`.
Guia de uso: `agent/README.md`.

O assistente responde em português perguntas como "Por que ontem consumi mais que a média?" ou "Por que a
conta de setembro veio com 100 kWh se eu injetei mais do que consumi?". A regra central da spec: **o LLM não
faz conta.** Os números vêm de ferramentas que chamam código já testado, e o LLM escolhe a ferramenta e redige.

### 8.1 Roteador e experts

- **Roteador** (`agent/src/router.ts`): o Gemini classifica a pergunta com saída estruturada
  (`withStructuredOutput` e um esquema zod). Se o modelo falhar, uma reserva por palavras-chave decide, e o
  registro marca que a reserva foi usada.
- **Três experts** (`agent/src/experts/definitions.ts`), cada um com papel, regras, ferramentas e coleções
  do RAG próprios:

  | Expert | Ferramentas | Coleções do RAG |
  |---|---|---|
  | consumo | `resumo_dia`, `comparar_periodo`, `buscar_documentos` | ResumoDiario, ProjetoDocs |
  | creditos | `creditos`, `resumo_dia`, `buscar_documentos` | RegrasEnergia, Contas, ProjetoDocs |
  | operacao | `status_coleta`, `buscar_documentos` | ProjetoDocs, RegrasEnergia |

  O expert de operação não vê a ferramenta de créditos, e assim por diante: cada expert só tem o que precisa.
- **Loop de ferramentas** (`agent/src/experts/loop.ts`): no máximo 6 passos. É um loop próprio, e não o
  `createAgent` do LangGraph (decisão D5 da spec), para registrar cada passo e testar sem depender dos
  detalhes internos do LangGraph.

### 8.2 Ferramentas e checagem de números

- As ferramentas (`agent/src/tools/`) são `tool()` do LangChain com esquema zod. Crédito mês a mês usa a
  mesma função do app (`app/credits-months.js`); o dia usa `v_house_daily`. Toda saída tem o campo `fonte`.
- **Checagem de números** (`agent/src/grounding.ts`): cada número da resposta precisa aparecer na pergunta
  ou nos argumentos e resultados das ferramentas, com tolerância de arredondamento. O que não aparece vai
  para `checagem.sem_fonte` no registro e conta como alucinação na avaliação.

### 8.3 RAG híbrido no Weaviate

- **Fontes indexadas** (`agent/src/rag/sources.ts`): READMEs, specs, a auditoria de segurança, as regras de
  compensação de energia escritas para o RAG (`agent/knowledge/regras-energia.md`), as 5 contas de exemplo
  sem dados pessoais e um resumo por dia. O `CLAUDE.md` fica fora, porque tem identificadores da casa.
- **Corte** por título do Markdown, guardando o caminho do arquivo para a resposta citar a fonte.
- **Embeddings** do Gemini (`gemini-embedding-001`) ou locais por hashing (`HashEmbeddings`, sem rede).
- **Weaviate** (`agent/src/rag/weaviate.ts`): uma coleção por fonte (ProjetoDocs, RegrasEnergia, Contas,
  ResumoDiario), vetores calculados no cliente (`selfProvided`, decisão D2) e busca `hybrid` (vetor + BM25)
  com `alpha = 0,5`. O Weaviate sobe pelo `agent/lab/docker-compose.yml` e indexa com `npm run ingest`.
- **Prova de funcionamento:** `agent/tests/weaviate.test.ts` indexa as quatro coleções num Weaviate real e
  confere que a busca híbrida acha o trecho do mínimo faturado. Esse teste roda no CI, que sobe o
  Weaviate 1.32.4 como serviço.

## 9. Avaliação do assistente

`agent/eval/dataset.json` tem 10 perguntas, com expert, ferramentas, números, palavras e documento esperados.
Os dados são os do modo demo com "hoje" fixo em 20/11/2026, então os números esperados não mudam. Cada
pergunta é julgada em sete critérios: expert, ferramentas, números, palavras, documento, sem alucinação (nenhum
número sem fonte) e sem erro.

| Execução | Modelo | Resultado | Arquivo |
|---|---|---|---|
| Real, 23/11/2026 | Gemini `gemini-3.8-flash` | **10 de 10**, todos os critérios | `agent/eval/results/gemini-2026-11-23.json` |
| Offline, em cada PR | modelo roteirizado, sem rede | 9 de 9 (a pergunta `rag-contadores-tuya` só roda com o Gemini) | `agent/eval/results/offline-2026-11-23.json` |

O arquivo da avaliação real guarda, por pergunta, a resposta, o registro completo, o tempo (7 a 22 s) e os
tokens. A avaliação offline prova o encanamento inteiro (roteamento, ferramentas, RAG, checagem e registro) e
roda no CI, que falha se algum critério falhar. Ela não mede a qualidade do Gemini.

**Ressalva.** A avaliação real com o Gemini usou o índice em memória (`MemoryStore`, `agent/eval/run.ts`) e
embeddings locais por hashing, e não o Weaviate. A busca híbrida é a mesma ideia nos dois stores, mas o
resultado 10/10 não mede o Weaviate. O Weaviate está coberto pelo teste de integração da seção 8.3. O executor da
avaliação fixa o índice em memória (`agent/eval/run.ts`), então avaliar no Weaviate exige antes mudar o
executor para respeitar `--store` (seção 13).

A análise das falhas, quando houver, é tarefa do subagente `avaliador-assistente` (`.claude/agents/`).

## 10. Observabilidade

**Coletor (produção):**

- cada rodada grava uma linha em `collector_runs`, com fonte, sucesso e horário;
- `v_collector_status` resume o estado por fonte;
- o app mostra "Atualizado HH:MM", a idade de cada leitura e "Pausa noturna" fora da janela da Solarman;
- o backfill mostra o progresso em `settings` (`solarman_backfill_*`).

**Assistente (laboratório):**

- **Registro por pergunta** (`agent/src/obs/log.ts`): uma linha JSON em `agent/logs/AAAA-MM-DD.jsonl` com o
  expert e o motivo do roteamento, se usou a reserva, cada passo (ferramenta, argumentos, duração, ok ou
  erro), os trechos recuperados (coleção, caminho, pontuação), tokens de entrada e saída, chamadas ao LLM, a
  checagem de números, a resposta e o tempo total.
- **Relatório** (`npm run report`, `agent/src/obs/report.ts`): perguntas por expert, uso da reserva,
  latência (média, p50, p95, máximo), tokens, ferramentas com erro, trechos do RAG por coleção, documentos
  mais recuperados e perguntas com número sem fonte. Amostra versionada em `agent/obs-amostra/`.
- **Painel Grafana** (`agent/lab/grafana/`): `npm run obs:export` grava os registros na tabela
  `obs.perguntas` do Postgres do laboratório, e o painel "Assistente de energia" mostra perguntas, tempo,
  tokens, números sem fonte, perguntas por expert e chamadas por ferramenta. As consultas do painel foram
  conferidas contra o Postgres com a amostra; o Grafana foi escrito num ambiente sem Docker, e a primeira
  subida foi feita pelo autor no próprio computador.

Não há alerta automático: o projeto é pessoal e o painel é de laboratório.

## 11. Skills, comandos e agentes customizados

Tudo versionado em `.claude/`, para o Claude Code usar em qualquer sessão neste repositório:

| Tipo | Nome | Para quê |
|---|---|---|
| Comando | `/testar` | roda as quatro suítes e resume o resultado |
| Comando | `/nova-migration` | cria uma migration com o teste primeiro, seguindo as regras de segurança |
| Comando | `/publicar-app` | checklist antes de publicar o PWA (versão, cache, CSP) |
| Comando | `/perguntar` | faz uma pergunta ao assistente no laboratório |
| Skill | `convencoes-energia` | convenções do domínio: sinais da rede, hora do fim, mínimo faturado, fuso, contadores da Tuya |
| Skill | `nova-ferramenta-assistente` | roteiro para adicionar uma ferramenta a um expert, com teste primeiro e esquema zod |
| Subagente | `revisor-migration` | revisa migrations e testes SQL antes do commit |
| Subagente | `revisor-assistente` | revisa mudanças no `agent/` (ferramentas, experts, RAG, testes, observabilidade) |
| Subagente | `avaliador-assistente` | roda a avaliação e analisa as falhas por pergunta |

`.claude/settings.json` libera sem pergunta só comandos de leitura e teste, nega a leitura de `.env*` e
pede confirmação para `supabase db push`, `vercel deploy` e `git push origin master`.

Também foram usadas skills externas (pacote superpowers: `brainstorming`, `writing-plans`,
`executing-plans`, `test-driven-development`) e ferramentas ligadas ao agente: o MCP do Supabase (consultas e
advisors, registrados em `docs/2026-11-22-isolamento-seguranca-supabase.md`), a CLI do Supabase e o GitHub.

## 12. Segurança revisada com IA

- **Segredos.** As chaves da Solarman e da Tuya só existem no cofre do Supabase. A chave do Gemini fica só
  em `agent/.env`. O repositório ignora `.env*`, e o `.claude/settings.json` impede o agente de ler esses
  arquivos.
- **Banco.** Há RLS nas tabelas, e o papel anônimo não lê tabelas nem views. A auditoria de 22/11/2026 criou
  `private.energy_users`, que restringe os dados ao usuário autorizado. A função `request_collect()` passou a
  validar `auth.uid()`, com limite de uma chamada a cada 30 s. Foram testados em produção um usuário
  autorizado e um não cadastrado, que recebe `SQLSTATE 42501`. A auditoria também removeu do banco objetos
  de outro projeto do autor e documentou o isolamento entre os dois. Tudo está versionado nas migrations
  `20261122192350` e `20261122200000` e coberto por `supabase/tests/05_security.test.sql`.
- **App.** Há CSP com `script-src 'self'` e `connect-src` limitado ao Supabase do projeto (nesta cópia, só `'self'`), nenhum script
  inline e nenhum CDN. O pdf.js passou a ser servido localmente, porque antes vinha de CDN sem verificação de
  integridade, no código que recebe o PDF e a senha da conta (commit `32580d1`). O teste
  `app/tests/security.test.mjs` impede a regressão.
- **Assistente.** Só faz `select`. O Postgres e o Weaviate do laboratório só escutam em `127.0.0.1`, e
  `agent/lab/prepare-db.sh` recusa um banco que já tenha `public.readings`. Ao Gemini vão só a pergunta, os
  resultados das ferramentas (dados simulados) e trechos de documentos sem dados pessoais.
- **Cadeia de dependências.** As dependências do assistente foram fixadas em versões com pelo menos duas
  semanas de publicação, para reduzir o risco de um pacote recém-publicado comprometido.

## 13. Limitações e próximos passos

- **Avaliação real no Weaviate.** A avaliação com o Gemini usou o índice em memória (seção 9). Para
  avaliar no Weaviate, o executor (`agent/eval/run.ts`, que hoje fixa `store: "memory"`) precisa primeiro
  respeitar a opção `--store`; depois a avaliação roda com `--store weaviate --embed gemini` no laboratório e
  o resultado é versionado.
- **Assistente fora da produção.** Por decisão do autor, o assistente só roda no laboratório com dados
  simulados. Ligá-lo ao banco real exigiria um papel de leitura próprio e uma tela no app.
- **Avaliação pequena.** São 10 perguntas. Elas cobrem os três experts e o RAG, mas não medem robustez a
  perguntas fora do domínio.
- **Pendências de produção fora da pós**, registradas no `CLAUDE.md`: proteção contra senhas vazadas no
  Supabase Auth e duas linhas antigas do histórico de migrations de outro projeto, a reparar com
  `supabase migration repair`.

## 14. Como avaliar em 10 minutos

1. Abrir https://energia-casa-demo.vercel.app no celular ou no navegador (dados de exemplo, sem login).
2. Ler o mapa de requisitos (seção 3) e abrir os arquivos citados.
3. Ver a última rodada do CI no GitHub (aba Actions): os quatro jobs passam.
4. Rodar localmente, com Node 22.18 ou mais novo:

   ```bash
   node --test app/tests/*.test.mjs
   node --test "supabase/functions/collect/tests/*.test.ts"
   cd agent && npm ci && npm test && npm run eval:offline
   node src/cli.ts --offline "Por que a conta de setembro veio com 100 kWh se eu injetei mais do que consumi?"
   ```

   A suíte SQL precisa de um Postgres local (`README.md`, seção "Rodar os testes"). Com uma chave do Gemini
   em `agent/.env`, `npm run eval` repete a avaliação real.
5. Ler `agent/eval/results/gemini-2026-11-23.json` para ver as respostas reais do Gemini e
   `docs/historico-ia.md` para ver como a IA foi usada e corrigida.
