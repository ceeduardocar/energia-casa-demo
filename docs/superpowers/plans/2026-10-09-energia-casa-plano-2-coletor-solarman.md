# Energia Casa — Plano 2: coletor Solarman

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gravar no Supabase a geração solar real a cada 5 minutos (potência e total acumulado) e importar o histórico da planta desde o início da operação, sem nenhum segredo no repositório, no app ou no chat.

**Architecture:** Uma Edge Function `collect` (Deno), chamada a cada 5 minutos pelo `pg_cron` + `pg_net`. A lógica fica em módulos TypeScript puros (sem dependências), que recebem `fetch` e um adaptador de banco por parâmetro e são testados com `node --test` (o Node 24 roda `.ts` direto). Só o `index.ts` conhece o Deno e o `supabase-js`. O backfill do histórico roda **dentro** da mesma função, um pedaço por rodada, até terminar.

**Tech Stack:** TypeScript (só sintaxe apagável), Deno (Supabase Edge Runtime), `npm:@supabase/supabase-js@2`, Node 24 para os testes, SQL.

**Spec:** `docs/superpowers/specs/2026-10-08-energia-casa-design.md` (seções 4.1, 6 item 1, 7, 9, 10 e fase 2 da seção 11).

**Escopo:** coletor Solarman ao vivo e backfill. A estrutura de `collect` já prevê várias fontes, mas a Tuya fica para o plano 3. Não muda as views nem o app.

## O que a API devolveu de verdade (testes de 2026-10-09)

Conferido com `scripts/solarman-check.mjs` e consultas avulsas. Os testes usam respostas com este formato.

- `POST /account/v1.0/token?appId=…&language=en`, corpo `{appSecret, email, password}`, com a senha em SHA-256 hex minúsculo. Resposta: `access_token`, `refresh_token`, `expires_in` (5183999 s, cerca de 60 dias), `success`. Credencial errada: HTTP 200 com `success:false`, `code:"2101025"`, `msg:"auth failed"`.
- `POST /station/v1.0/list`, `{page, size}` → `stationList[]` com `id`, `name`, `startOperatingTime` (epoch s), `regionTimezone` (`America/Sao_Paulo`). Há uma planta só (2 coletores + 2 microinversores).
- `POST /station/v1.0/realTime`, `{stationId}` → `generationPower` (W), `generationTotal` (kWh, 1 casa decimal), `lastUpdateTime` (epoch s). **Não traz a energia do dia.**
- `POST /station/v1.0/history`, `{stationId, timeType, startTime, endTime}` → `stationDataItems[]`:
  - `timeType:1` (quadros de 5 min): **um dia por pedido** (pedir 2 dias devolve só um). Só `generationPower` e `dateTime` (epoch s, alinhado a 5 min). Os quadros vão das 05:45 às 18:10: **à noite o logger não envia nada**. Há quadros em 2024-06 e não há em 2022-11 (retenção de uns 2 anos).
  - `timeType:2` (diário, `YYYY-MM-DD`): `generationValue` (kWh do dia) e `year`/`month`/`day`. No máximo 31 dias por pedido (`code 2101012`).
  - `timeType:3` (mensal): no máximo 12 meses (`code 2101013`). Não é usado.
  - `timeType:4` (anual): de 2022 a 2026. A soma dos anos (20.353,6 kWh) é menor que `generationTotal` (20.588,3 kWh). Só as diferenças importam, então isso não atrapalha.
- Início da operação: `startOperatingTime` = 2022-10-10 (primeiro dia com geração no diário: 10/10/2022, 0,9 kWh).

## Decisões deste plano (desvios e acréscimos à spec)

1. **`ts` vem de `lastUpdateTime`** (arredondado para baixo ao passo de 5 min), e não da hora da coleta. Se o logger parar, não entram leituras repetidas com hora nova, e o `v_now` mostra a idade real. A escrita idempotente faz a rodada seguinte com o mesmo `lastUpdateTime` gravar 0 linhas.
2. **Noite:** sem quadro novo, a rodada grava 0 linhas e fica `ok = true`. A última potência do dia é 0 W (confirmado nos quadros), então o app mostra 0 W à noite sem nenhuma mudança. O critério "24 h sem buracos" da spec passa a ser "sem buracos enquanto o logger envia (do nascer ao pôr do sol)".
3. **Mapeamento fixo no código para a Solarman:** `generationPower → power_w` e `generationTotal → energy_total_kwh`. São campos fixos da API, e só a Tuya precisa de `device_metric_map`.
4. **Planta descoberta sozinha:** se `devices.external_id` de `solar_plant` estiver nulo, a função chama `station/list`, exige exatamente 1 planta e grava o `id`. Assim nenhum ID fica fixo no repositório.
5. **Segredo da senha:** o Supabase guarda `SOLARMAN_PASSWORD_SHA256`, e não a senha em texto. Ela continua só no `.env.solarman` local.
6. **Backfill dentro do `collect`:** a spec previa uma função separada rodada à mão. Aqui, depois da coleta ao vivo, cada rodada processa até `solarman_backfill_days_per_run` dias (padrão 10), indo do dia de início da coleta para trás. São cerca de 1.460 dias, ou ~146 rodadas (~12 h). Nada é rodado no PC e nenhum segredo sai do Supabase. Falha no backfill não derruba a coleta ao vivo.
7. **Histórico como hodômetro.** `readings` guarda acumulado, e o histórico traz kWh por dia e potência de 5 min. Para cada dia D:
   - `B(D)` = hodômetro no início do dia. Encadeado para trás: `B(D) = B(D+1) − diário(D)`.
   - Âncora no dia S da primeira leitura ao vivo (`t0`, valor `L0`): `B(S) = L0 − c_S(t0)`, gravando no dia S só as leituras com `ts < t0`.
   - **Dia com quadros:** `c(t)` = integral da potência (trapézios) desde o primeiro quadro, normalizada para o último quadro valer exatamente `diário(D)`. Grava `power_w` e `energy_total_kwh = B(D) + c(t)` em cada quadro. Assim os gráficos por hora dos dias antigos ficam certos.
   - **Dia sem quadros** (ou integral zero com diário > 0): uma única leitura `energy_total_kwh = B(D) + diário(D)` às 23:55 locais. O dia fica certo, mas a hora não.
   - O erro na emenda com o ao vivo fica em décimos de kWh, uma vez só. Diferença negativa já vale 0 nas views.
8. **Tempo de espera do token:** com validade de 60 dias, a função renova quando faltar menos de 1 dia (a spec dizia 10 min, pensando na Tuya). Também renova uma vez se a API recusar o token.
9. **Gatilho protegido por segredo próprio:** a função é publicada sem verificação de JWT e exige o cabeçalho `x-collect-secret` igual ao secret `COLLECT_SECRET`. O `pg_cron` lê esse valor do Vault. A chave `anon` (pública) não aciona a coleta.

## Global Constraints

- Coletor **somente leitura** na Solarman: só os endpoints acima.
- Cota: 200 mil chamadas por ano. Ao vivo: 1 chamada por rodada (~105 mil por ano), mais o token a cada ~60 dias. Backfill: ~1.500 chamadas no total, uma vez só.
- `readings`: `ts` sempre múltiplo de 5 min (UTC), escrita com `ON CONFLICT DO NOTHING` (`upsert` com `ignoreDuplicates: true`), em lotes de até 1.000 linhas.
- Dias e "23:55 locais" sempre em `America/Sao_Paulo`. Desde 2019 é UTC−3 fixo, mas use `Intl` com `timeZone` e não um deslocamento fixo.
- Validação ao vivo: potência < 0 ou > `solar_max_power_w` (padrão 6000) é descartada e anotada. Total menor que a leitura anterior é gravado e anotado.
- Nenhum valor de segredo em código, testes, logs, `error_message` nem no chat. As mensagens de erro citam o caminho sem a query (`/account/v1.0/token`, sem `appId`).
- Módulos em `supabase/functions/collect/`: só sintaxe TypeScript apagável (sem `enum`, `namespace` nem parameter properties), imports com extensão `.ts` e `import type` para tipos, para rodar igual no Deno e no Node 24.
- Tempo limite por fonte: 25 s para a coleta ao vivo e 90 s para o backfill. O limite da Edge Function no plano free é 150 s.

## Review Focus

1. Mesma `lastUpdateTime` em duas rodadas: a segunda grava 0 linhas, sem erro. (Tarefa 4)
2. Token vencendo, token recusado com renovação que funciona e com renovação que falha (uma tentativa só, sem laço). (Tarefa 3)
3. Resposta com campo faltando ou `success:false`: a rodada registra erro claro e não grava lixo. (Tarefas 3 e 4)
4. Integral normalizada: a soma dos deltas do dia é exatamente `diário(D)`, e nenhuma leitura cai fora da grade de 5 min. (Tarefa 5)
5. Encadeamento do backfill entre rodadas (`B` salvo em settings) e a parada no dia de início da operação. (Tarefa 5)
6. Erro na Solarman não impede outra fonte, e erro no backfill não marca a coleta ao vivo como falha. (Tarefa 6)

## Estrutura de arquivos

```
supabase/migrations/20261009000200_solarman.sql   settings do coletor
supabase/tests/08_solarman.test.sql
supabase/functions/collect/types.ts               Db, Reading, Clock, tipos das respostas
supabase/functions/collect/time.ts                bin de 5 min, dia local, 23:55 local
supabase/functions/collect/solarman.ts            cliente: token, post, endpoints
supabase/functions/collect/live.ts                coleta ao vivo -> linhas validadas
supabase/functions/collect/backfill.ts            dia -> leituras; passo do backfill com cursor
supabase/functions/collect/run.ts                 roda as fontes, tempo limite, collector_runs
supabase/functions/collect/index.ts               Deno.serve, cabeçalho secreto, adaptador supabase-js
supabase/functions/collect/tests/fakes.ts         fetch falso (fila de respostas) e Db em memória
supabase/functions/collect/tests/*.test.ts
supabase/cron_collect.sql                         agenda o pg_cron (rodado à mão; não é migration)
scripts/solarman-check.mjs                        teste de conexão local (já existe)
scripts/make-supabase-secrets.mjs                 gera .env.supabase (ignorado) a partir do .env.solarman
supabase/config.toml                              [functions.collect] verify_jwt = false
```

Testes do coletor: `node --test "supabase/functions/collect/tests/*.test.ts"`.

Interface do banco (`types.ts`), implementada pelo `index.ts` (supabase-js) e por `fakes.ts` (memória):

```ts
export type Reading = { device_id: string; metric: string; ts: string; value: number };
export interface Db {
  getToken(source: string): Promise<{ token: string; expires_at: string } | null>;
  saveToken(source: string, token: string, expiresAt: string): Promise<void>;
  getExternalId(deviceId: string): Promise<string | null>;
  setExternalId(deviceId: string, externalId: string): Promise<void>;
  insertReadings(rows: Reading[]): Promise<number>;            // devolve quantas entraram
  lastReading(deviceId: string, metric: string): Promise<{ ts: string; value: number } | null>;
  firstReading(deviceId: string, metric: string): Promise<{ ts: string; value: number } | null>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  logRun(run: { source: string; ok: boolean; readings_written: number; error_message: string | null }): Promise<void>;
}
```

---

### Tarefa 1: settings do coletor

**Files:** `supabase/migrations/20261009000200_solarman.sql`, `supabase/tests/08_solarman.test.sql`

- [ ] **Step 1: Teste** (convenção do plano 1: `begin` … `rollback`):
  - as chaves `solar_max_power_w` (`6000`), `solarman_backfill_enabled` (`true`) e `solarman_backfill_days_per_run` (`10`) existem;
  - `solarman_backfill_cursor`, `solarman_backfill_base` e `solarman_backfill_done` **não** existem no início;
  - `authenticated` continua sem acesso a `api_tokens` (regressão).
- [ ] **Step 2:** Rodar o teste e ver falhar.
- [ ] **Step 3: Migration:** `insert into settings … on conflict (key) do nothing` das três chaves.
- [ ] **Step 4:** `scripts/test-db.sh` passando por inteiro (PG 17 portátil, ver CLAUDE.md).
- [ ] **Step 5:** Commit.

### Tarefa 2: tempo e fakes

**Files:** `types.ts`, `time.ts`, `tests/fakes.ts`, `tests/time.test.ts`

- [ ] **Step 1: Testes de `time.ts`:**
  - `bin5(1791538339)` → `2026-10-09T09:30:00.000Z`;
  - `localDay(epoch)` dá o dia em `America/Sao_Paulo`, inclusive às 00:00 locais (03:00 UTC) e às 23:59 locais;
  - `localEndSlot("2022-11-15")` → `2022-11-16T02:55:00.000Z`;
  - `addDays("2026-03-01", -1)` → `2026-02-28`.
- [ ] **Step 2: Implementar** `time.ts` com `Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })`.
- [ ] **Step 3: `fakes.ts`:**
  - `fakeFetch(respostas)` responde em ordem e guarda cada pedido (URL, cabeçalhos, corpo) para as asserções;
  - `memDb()` implementa `Db`, e `insertReadings` ignora a chave repetida (`device_id`, `metric`, `ts`);
  - `fixedClock(iso)`.
- [ ] **Step 4:** Testes passando e commit.

### Tarefa 3: cliente Solarman

**Files:** `solarman.ts`, `tests/solarman.test.ts`

`createSolarman({ fetch, db, clock, env })`, onde `env` tem `appId`, `appSecret`, `email` e `passwordSha256`. Métodos: `stations()`, `realTime(id)`, `frames(id, day)` e `daily(id, from, to)`. Base `https://globalapi.solarmanpv.com`, sempre `?language=en` e `Authorization: bearer <token>`.

- [ ] **Step 1: Testes:**
  - sem token salvo: faz login (corpo com `appSecret`, `email` e `password` = hash recebido; `appId` só na URL) e salva `expires_at = agora + expires_in`;
  - token salvo com mais de 1 dia de validade: nenhum login;
  - faltando menos de 1 dia: renova;
  - API recusa o token (HTTP 401, ou `success:false` com `msg` contendo "token"): renova uma vez e repete. Se recusar de novo, lança erro e não faz um terceiro pedido;
  - `success:false` (por exemplo `2101025 auth failed`): erro `"/account/v1.0/token: code=2101025 msg=auth failed"`, sem `appId` nem segredo na mensagem;
  - erro de rede (`fetch` lança): erro com o caminho;
  - `daily` com intervalo de mais de 31 dias lança erro antes de chamar a API.
- [ ] **Step 2:** Implementar.
- [ ] **Step 3:** Testes passando e commit.

### Tarefa 4: coleta ao vivo

**Files:** `live.ts`, `tests/live.test.ts`

`collectLive({ sm, db, maxPowerW })` → `{ written, notes: string[] }`.

- [ ] **Step 1: Testes:**
  - `external_id` nulo: chama `stations()`, grava o id e segue. Com 0 ou 2+ plantas, erro `"esperava 1 planta, achei N"`;
  - caso normal (`generationPower:152`, `generationTotal:20588.3`, `lastUpdateTime:1791538339`): 2 linhas `solar_plant` com `ts 09:30Z`;
  - mesma resposta duas vezes: a segunda devolve `written = 0`, sem erro;
  - `lastUpdateTime` ausente, ou `generationTotal` ausente ou não numérico: erro `"resposta sem <campo>"` e nada gravado. Potência ausente com total presente: grava só o total e anota;
  - potência −5 ou 7000 (teto 6000): grava só o total e anota `"potência fora da faixa: 7000 W"`;
  - total menor que a última leitura: grava e anota `"total diminuiu: 20588.3 -> 20500"`.
- [ ] **Step 2:** Implementar.
- [ ] **Step 3:** Testes passando e commit.

### Tarefa 5: backfill

**Files:** `backfill.ts`, `tests/backfill.test.ts`

Duas partes:
- `buildDay({ day, frames, dailyKwh, base, before? })` → `{ rows, end }`, função pura em que `end = base + dailyKwh`;
- `backfillStep({ sm, db, clock, daysPerRun })` → `{ written, done, notes }`.

- [ ] **Step 1: Testes de `buildDay`:**
  - quadros com potência constante de 1000 W das 10:00 às 12:00 e diário 2,0: o último `energy_total_kwh` = `base + 2.0`, os valores nunca diminuem e todo `ts` cai na grade de 5 min;
  - formato real (150 quadros com zeros nas pontas, diário 19,8): soma dos deltas = 19,8 (tolerância 0,001);
  - dia sem quadros: 1 linha às 23:55 locais com `base + diário`;
  - quadros com potência toda zero e diário > 0: mesmo tratamento do dia sem quadros;
  - diário 0: linhas de potência gravadas, e o total fica em `base`;
  - com `before` (dia S): só linhas com `ts < before`;
  - dois quadros no mesmo bin: fica o último.
- [ ] **Step 2: Testes de `backfillStep`:**
  - `solarman_backfill_enabled` ≠ `true` ou `done` = `true`: não faz nada e não chama a API;
  - sem leitura ao vivo ainda: não faz nada;
  - o dia de `t0` ainda é hoje (dia local): não faz nada, porque o diário de S ainda não fechou;
  - primeira rodada: âncora `B(S) = L0 − c_S(t0)`, processa S e mais `daysPerRun − 1` dias para trás, e salva `cursor` = próximo dia e `base` = `B(cursor + 1)`;
  - rodada seguinte: continua de `cursor` com `base`, e o hodômetro fica contínuo na emenda entre rodadas;
  - para no dia de `startOperatingTime` (lido de `stations()` uma vez e guardado em settings `solarman_backfill_start`) e grava `done = true`;
  - um único pedido `daily` cobre os dias da rodada (no máximo 31 dias) e um pedido `frames` é feito por dia;
  - erro da API no meio: não avança o cursor além do último dia gravado e repassa o erro.
- [ ] **Step 3:** Implementar. Arredonde os kWh a 0,001 e use `upsert` em lotes de 1.000.
- [ ] **Step 4:** Testes passando e commit.

### Tarefa 6: runner

**Files:** `run.ts`, `tests/run.test.ts`

`runAll({ sources, db, timeoutMs })`: cada fonte é `{ name, live, backfill? }`.

- [ ] **Step 1: Testes:**
  - sucesso: 1 linha em `collector_runs` (`ok = true`, `readings_written` = ao vivo + backfill, `error_message` = notas unidas por `"; "` ou nulo);
  - ao vivo lança erro: `ok = false`, a mensagem vai para `error_message` e o backfill não roda;
  - backfill lança erro: `ok = true` e `error_message` com `"backfill: …"`;
  - fonte que estoura o tempo limite: `ok = false`, `"tempo esgotado (25 s)"`, e a fonte seguinte roda mesmo assim;
  - `error_message` cortada em 500 caracteres.
- [ ] **Step 2:** Implementar com `Promise.race`.
- [ ] **Step 3:** Testes passando e commit.

### Tarefa 7: entrada Deno e publicação

**Files:** `index.ts`, `supabase/config.toml`, `scripts/make-supabase-secrets.mjs`, `supabase/cron_collect.sql`, `README.md`

- [ ] **Step 1: `index.ts`:**
  - `Deno.serve`: só aceita `POST` com `x-collect-secret` igual a `Deno.env.get("COLLECT_SECRET")`, comparado em tempo constante; senão responde 401;
  - lê `SOLARMAN_*` do ambiente; se faltar algum, a rodada grava `ok = false`, `"secret ausente: SOLARMAN_APP_ID"` (só o nome);
  - adaptador `Db` com `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`, que são variáveis automáticas da função; `insertReadings` usa `upsert(rows, { onConflict: "device_id,metric,ts", ignoreDuplicates: true }).select("ts")` e conta as linhas devolvidas;
  - responde `{ ok, written }`, sem detalhes.
- [ ] **Step 2: `config.toml`:** `[functions.collect]` com `verify_jwt = false`.
- [ ] **Step 3: `scripts/make-supabase-secrets.mjs`:** lê o `.env.solarman` e gera o `.env.supabase` (ignorado por `.env*`) com:
  - `SOLARMAN_APP_ID`, `SOLARMAN_APP_SECRET` e `SOLARMAN_EMAIL`;
  - `SOLARMAN_PASSWORD_SHA256`;
  - `COLLECT_SECRET` (32 bytes aleatórios em hex, mantido se o arquivo já existir).

  Ele não imprime nenhum valor, só os nomes.
- [ ] **Step 4: `supabase/cron_collect.sql`**, rodado à mão no editor SQL:
  - `create extension if not exists pg_cron` e `pg_net`;
  - lê `project_url` e `collect_secret` do `vault.decrypted_secrets` e falha com mensagem clara se faltarem;
  - `cron.schedule('collect', '*/5 * * * *', …net.http_post(… headers x-collect-secret …))`, idempotente (`cron.unschedule` antes, se existir).

  Os dois segredos do Vault são criados uma vez pelo painel (Vault → New secret), e não por arquivo do repositório.
- [ ] **Step 5: README**, seção "Coletor Solarman" com os passos da tarefa 8 e as consultas de conferência.
- [ ] **Step 6:** Os testes não carregam o `index.ts`, porque ele importa `npm:` e `Deno`. Ele é conferido na publicação (tarefa 8). Rodar `node --test` de novo e fazer o commit.

### Tarefa 8: no PC do César, com as chaves reais

Feita junto com o César, no terminal dele. Nenhum valor aparece no chat.

- [ ] **Step 1:** `supabase db push`, que aplica a migration da tarefa 1.
- [ ] **Step 2:** `node scripts/make-supabase-secrets.mjs` e depois `supabase secrets set --env-file .env.supabase`.
- [ ] **Step 3:** `supabase functions deploy collect --no-verify-jwt --use-api` (sem Docker).
- [ ] **Step 4:** Criar no Vault os segredos:
  - `project_url` = `https://<PROJECT_REF>.supabase.co`;
  - `collect_secret` = o valor de `COLLECT_SECRET` no `.env.supabase`, colado direto no painel.

  Depois rodar `supabase/cron_collect.sql` no editor SQL.
- [ ] **Step 5: Conferir depois de 15 min** (editor SQL):
  - `select * from collector_runs order by id desc limit 5`: `ok = true`, e `readings_written` com 2 de dia ou 0 de noite;
  - `select * from v_now where device_id = 'solar_plant'`.
- [ ] **Step 6: Conferir o backfill** (~12 h): `settings.solarman_backfill_done = 'true'`. Comparar `v_energy_daily` da `solar_plant` nos últimos 10 dias e em 3 meses antigos com o app SOLARMAN Smart (tolerância de 0,2 kWh por dia).
- [ ] **Step 7: Critério da fase 2:** no dia seguinte, a contagem de `power_w` da `solar_plant` entre o nascer e o pôr do sol bate com os quadros da Solarman do mesmo dia (sem buracos), e o app mostra a geração real.

### Tarefa 9: documentação

- [ ] Spec: registrar as decisões 1 a 9 nas seções 4.1, 7, 9 e 11, e apagar a premissa "a API ainda precisa ser ativada".
- [ ] `CLAUDE.md`: estado, comando dos testes do coletor e pendências.
- [ ] `README.md`: marcar o plano 2 como feito.
- [ ] Commit.
