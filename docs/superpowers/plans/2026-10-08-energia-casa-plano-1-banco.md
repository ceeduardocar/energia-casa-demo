# Energia Casa — Plano 1: banco e contas prontas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o banco do Energia Casa (tabelas, views de cálculo, segurança e dados de demonstração) com testes automatizados que provam cada conta, pronto para ser aplicado num projeto Supabase.

**Architecture:** Migrations SQL puras do Postgres (compatíveis com Supabase) em `supabase/migrations/`, testadas por scripts SQL com asserções simples contra um Postgres 16 descartável. Nada de aplicação nem de chave de API neste plano. Os coletores (Solarman, Tuya), o app e as contas de luz ficam em planos próprios, porque dependem de ativações externas.

**Tech Stack:** PostgreSQL 15+ (testado no 16), SQL, bash e `psql`. Sem dependências de Node ou Python.

**Spec:** `docs/superpowers/specs/2026-10-08-energia-casa-design.md` (seções 5, 6, 10 e fase 1 da seção 11).

**Escopo deste plano:** seção 5 da spec **exceto** a tabela `bills` e a view `v_bill_check` (plano das contas de luz), e a seção 6 itens 1 a 5. Não inclui coletor, app, nem importação de histórico.

## Global Constraints

- Horários em `timestamptz`; dias, horas, semanas e meses calculados em `America/Sao_Paulo`.
- Dispositivos fixos: `solar_plant`, `grid_meter`, `appliance_ac`, `appliance_boiler`.
- Métricas internas permitidas: `power_w`, `energy_total_kwh`, `energy_import_total_kwh`, `energy_export_total_kwh`, `voltage_v`. Unidades: W, kWh, V.
- `readings`: chave primária (`device_id`, `metric`, `ts`); `ts` arredondado ao passo de 5 minutos; escrita com `ON CONFLICT DO NOTHING`.
- Diferença negativa de acumulado (contador zerado ou aparelho trocado) conta como 0.
- Consumo da casa = geração + importado − exportado. Autoconsumo = geração − exportado. Autossuficiência = autoconsumo ÷ consumo (0 se consumo = 0). Outros = max(consumo − ar − boiler, 0).
- Saldo de créditos = saldo do último `credit_baseline` + exportado − importado desde `as_of`. Estimativa de duração = saldo ÷ média diária de (importado − exportado) dos últimos 8 dias, só quando essa média for positiva.
- RLS ligado em todas as tabelas. Usuário `authenticated` lê as views; grava só `credit_baseline` e `settings`; nunca escreve em `readings`. `api_tokens` e `collector_runs` sem acesso do app. `anon` sem acesso a nada.
- Views `v_*` de cálculo usam `security_invoker = true`. `v_collector_status` não expõe `error_message`.
- Nenhuma chave, senha ou segredo no repositório.

## Review Focus

Entradas e condições que a spec implica e nenhuma tarefa de cálculo cobriria por si só (cada uma tem teste na tarefa indicada):

1. Contador de energia que zera ou diminui (aparelho trocado): o dia não pode ficar negativo nem gigante. (Tarefa 3)
2. Leitura que cai exatamente na virada do dia em Brasília (00:00 local = 03:00 UTC): vai para o dia certo. (Tarefa 3)
3. Dia em que uma fonte não gravou nada: a conta devolve nulo, não zero, para aquela fonte. (Tarefa 5)
4. Consumo zero ou sem baseline de créditos: sem divisão por zero e sem erro; `v_credits` vazia sem baseline; `days_left` nulo quando o saldo está subindo. (Tarefas 5 e 6)
5. Usuário `anon` ou `authenticated` tentando ler `api_tokens`, `collector_runs.error_message` ou escrever em `readings`. (Tarefa 8)

## Estrutura de arquivos

```
.gitignore
README.md                                   como rodar os testes e aplicar no Supabase
scripts/test-db.sh                          roda bootstrap, migrations e testes num banco descartável
scripts/local-pg.sh                         sobe/derruba um Postgres temporário para testes locais
supabase/migrations/20261008000100_core_tables.sql
supabase/migrations/20261008000200_energy_views.sql
supabase/migrations/20261008000300_house_views.sql
supabase/migrations/20261008000400_security.sql
supabase/seed_demo.sql                      30 dias de leituras de demonstração (não é migration)
supabase/tests/_bootstrap.sql               cria papéis e funções de asserção (só no banco de teste)
supabase/tests/01_core_tables.test.sql
supabase/tests/02_energy_views.test.sql
supabase/tests/03_house_views.test.sql
supabase/tests/04_credits_boiler.test.sql
supabase/tests/05_security.test.sql
supabase/tests/06_seed_demo.test.sql
```

Convenção dos testes: cada arquivo `*.test.sql` começa com `begin;`, insere seus próprios dados, usa as funções de `_bootstrap.sql` e termina com `rollback;`. Qualquer asserção falha com `raise exception`, e o `psql` roda com `ON_ERROR_STOP=1`.

---

### Task 1: Esqueleto do repositório e executor de testes

**Files:**
- Create: `.gitignore`, `README.md`, `scripts/test-db.sh`, `scripts/local-pg.sh`, `supabase/tests/_bootstrap.sql`
- Test: `supabase/tests/00_harness.test.sql`

**Interfaces:**
- Produces: `scripts/test-db.sh` (usa `DATABASE_URL` de um banco **vazio e descartável**; aplica `_bootstrap.sql`, depois todas as migrations em ordem, depois cada `*.test.sql`; sai com código ≠ 0 se algo falhar). `scripts/local-pg.sh start|stop` (sobe um Postgres temporário em `/tmp/energia-pg` na porta 54329 e imprime a `DATABASE_URL`). Funções no schema `test`: `test.eq(label text, actual numeric, expected numeric, tol numeric default 0.0001) returns void`, `test.is_null(label text, actual anyelement) returns void`, `test.ok(label text, cond boolean) returns void`, `test.throws(label text, sql text) returns void`. Papéis `anon`, `authenticated` e `service_role` (este com `BYPASSRLS`), criados só se não existirem.

- [ ] **Step 1: Escrever o teste do próprio executor** em `supabase/tests/00_harness.test.sql`: `select test.eq('soma', 1+1, 2);`, `select test.ok('verdade', true);`, `select test.throws('divisão por zero', 'select 1/0');`.
- [ ] **Step 2: Rodar e ver falhar:** `scripts/test-db.sh` ainda não existe → erro "No such file".
- [ ] **Step 3: Implementar `supabase/tests/_bootstrap.sql`** com as quatro funções e os três papéis (idempotente). `test.eq` levanta `FAIL: <label>: got <a> expected <b>`; `test.throws` executa o SQL em bloco `begin ... exception` e levanta `FAIL: <label>: no error` se não houver erro.
- [ ] **Step 4: Implementar `scripts/test-db.sh`**: exige `DATABASE_URL`, recusa rodar se o banco já tiver a tabela `public.readings` (proteção contra banco real) a menos que `RESET_TEST_DB=1`, aplica bootstrap, migrations (ordem alfabética) e testes (ordem alfabética, ignorando arquivos que começam com `_`). Implementar `scripts/local-pg.sh`: `initdb` + `pg_ctl` num diretório temporário, trust, porta 54329, socket em `/tmp/energia-pg`; se for root, roda como um usuário sem privilégios criado para isso.
- [ ] **Step 5: Rodar:** `scripts/local-pg.sh start` e `DATABASE_URL=<impresso> scripts/test-db.sh`. Esperado: `00_harness.test.sql` passa e o script termina com código 0; trocar `2` por `3` na asserção faz o script terminar com código ≠ 0.
- [ ] **Step 6: Escrever `README.md`** (como subir o Postgres de teste, rodar os testes, e a seção "Aplicar no Supabase" com `supabase db push`, a ser completada na Tarefa 9) e `.gitignore` (`.env*`, `supabase/.temp/`).
- [ ] **Step 7: Commit** `chore: scaffold repo and sql test runner`.

---

### Task 2: Tabelas base

**Files:**
- Create: `supabase/migrations/20261008000100_core_tables.sql`
- Test: `supabase/tests/01_core_tables.test.sql`

**Interfaces:**
- Consumes: `test.*` da Tarefa 1.
- Produces: tabelas `public.devices(id text pk, source text, kind text, name text, external_id text)`, `public.readings(device_id text, metric text, ts timestamptz, value double precision)` com PK (`device_id`, `metric`, `ts`), `public.device_metric_map(source text, external_id text, source_code text, device_id text, metric text, scale double precision default 1)`, `public.api_tokens(source text pk, token text, expires_at timestamptz)`, `public.collector_runs(id bigint identity pk, started_at timestamptz, source text, ok boolean, readings_written int, error_message text)`, `public.credit_baseline(as_of date pk, balance_kwh double precision, source text default 'manual', bill_id bigint null)`, `public.settings(key text pk, value text)`. Linhas iniciais em `devices` (os quatro ids fixos, com `source` e `kind` da spec) e em `settings`: `stale_after_minutes = '15'`, `solar_low_kwh_per_hour = '0.2'`, `credit_trend_days = '8'`.

- [ ] **Step 1: Escrever os testes** em `01_core_tables.test.sql`:
  - `quatro dispositivos` — `select count(*) from devices` = 4 e os ids são `solar_plant`, `grid_meter`, `appliance_ac`, `appliance_boiler`.
  - `metrica invalida` — `test.throws` ao inserir métrica `foo` em `readings`.
  - `ts fora do passo de 5 min` — `test.throws` ao inserir `ts = '2026-10-08 12:07:00+00'`.
  - `dispositivo inexistente` — `test.throws` ao inserir leitura com `device_id = 'x'`.
  - `idempotencia` — duas inserções iguais com `on conflict do nothing` resultam em 1 linha; a segunda, com o mesmo `ts` e valor diferente, não altera o valor original.
  - `settings padrao` — as três chaves existem com os valores acima.
- [ ] **Step 2: Rodar e ver falhar:** `scripts/test-db.sh` → falha em `01_core_tables` (tabelas inexistentes).
- [ ] **Step 3: Implementar a migration** com as tabelas acima: `check` em `readings.metric` (cinco métricas permitidas), `check (ts = date_bin('5 minutes', ts, timestamptz '2000-01-01 00:00:00+00'))`, `device_id` com chave estrangeira para `devices`, `devices.source in ('solarman','tuya')`, `devices.kind in ('solar_plant','grid_meter','appliance_meter')`.
- [ ] **Step 4: Rodar:** esperado `scripts/test-db.sh` termina com código 0.
- [ ] **Step 5: Commit** `feat(db): core tables with constraints and device seed`.

---

### Task 3: Energia por hora e por dia (diferença de acumulado)

**Files:**
- Create: `supabase/migrations/20261008000200_energy_views.sql`
- Test: `supabase/tests/02_energy_views.test.sql`

**Interfaces:**
- Consumes: `readings` (Tarefa 2).
- Produces:
  - `v_energy_deltas(device_id text, metric text, ts timestamptz, delta_kwh double precision)`: uma linha por leitura de métrica `energy_%`, com `delta_kwh = greatest(value − valor_anterior, 0)` do mesmo (`device_id`, `metric`) em ordem de `ts`; a primeira leitura de cada série tem delta 0. A diferença é atribuída ao horário da leitura mais recente.
  - `v_energy_hourly(device_id text, metric text, hour_local timestamp, kwh double precision)`: soma dos deltas por hora local (`date_trunc('hour', ts at time zone 'America/Sao_Paulo')`).
  - `v_energy_daily(device_id text, metric text, day date, kwh double precision)`: soma dos deltas por dia local.
  - `v_power_hourly(device_id text, hour_local timestamp, avg_power_w double precision)`: média de `power_w` por hora local.

- [ ] **Step 1: Escrever os testes** em `02_energy_views.test.sql` (dispositivo `solar_plant`, métrica `energy_total_kwh`):
  - `dia normal` — leituras 100 (`2026-10-08 03:00+00`), 105 (`12:00+00`), 109 (`2026-10-09 02:55+00`) → `v_energy_daily` do dia `2026-10-08` = 9 e a hora local `2026-10-08 09:00` tem 4.
  - `primeira leitura tem delta zero` — com uma única leitura, `v_energy_daily` do dia dela = 0.
  - `contador que zera` — leituras 100, 105, 3 (zerou), 6 no mesmo dia → soma do dia = 5 + 0 + 3 = 8 (a queda de 105 para 3 conta 0; 3 para 6 conta 3), e nenhuma linha de `v_energy_deltas` é negativa.
  - `virada do dia em Brasilia` — leitura às `2026-10-08 02:55+00` (23:55 do dia 7) e às `2026-10-08 03:00+00` (00:00 do dia 8): o delta entre as duas pertence ao dia `2026-10-08`, e o dia `2026-10-07` tem soma 0.
  - `series independentes` — deltas de `energy_import_total_kwh` e `energy_export_total_kwh` do `grid_meter` não se misturam (cada série usa só o seu valor anterior).
  - `potencia media por hora` — `power_w` 600 e 800 na mesma hora local → `avg_power_w = 700`.
- [ ] **Step 2: Rodar e ver falhar:** views inexistentes.
- [ ] **Step 3: Implementar a migration** com as quatro views usando função de janela `lag(...) over (partition by device_id, metric order by ts)`.
- [ ] **Step 4: Rodar:** `scripts/test-db.sh` passa (testes 01 e 02).
- [ ] **Step 5: Commit** `feat(db): hourly and daily energy views from counter deltas`.

---

### Task 4: Estado atual (`v_now`)

**Files:**
- Modify: `supabase/migrations/20261008000200_energy_views.sql` (acrescentar ao fim)
- Test: `supabase/tests/02_energy_views.test.sql` (acrescentar casos)

**Interfaces:**
- Consumes: `readings`, `settings`.
- Produces: `v_now(device_id text, metric text, ts timestamptz, value double precision, age_minutes double precision, is_stale boolean)`: última leitura de cada (`device_id`, `metric`); `age_minutes` = minutos desde `ts`; `is_stale` = `age_minutes > settings.stale_after_minutes`.

- [ ] **Step 1: Escrever os testes:** `ultima leitura vence` (duas leituras do mesmo par, `v_now` devolve a de `ts` maior); `idade` (leitura de 30 min atrás em `now()` arredondado → `age_minutes` entre 29 e 31 e `is_stale` verdadeiro; leitura de 5 min atrás → `is_stale` falso); `limite configuravel` (após `update settings set value='60' where key='stale_after_minutes'`, a leitura de 30 min deixa de ser antiga).
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar `v_now`** com `distinct on (device_id, metric) ... order by device_id, metric, ts desc`. O `ts` das leituras de teste é calculado em SQL como `date_bin('5 minutes', now() - interval '30 minutes', timestamptz '2000-01-01')`.
- [ ] **Step 4: Rodar:** passa.
- [ ] **Step 5: Commit** `feat(db): v_now with staleness`.

---

### Task 5: Casa por hora e por dia

**Files:**
- Create: `supabase/migrations/20261008000300_house_views.sql`
- Test: `supabase/tests/03_house_views.test.sql`

**Interfaces:**
- Consumes: `v_energy_hourly`, `v_energy_daily` (Tarefa 3).
- Produces:
  - `v_house_hourly(hour_local timestamp, g double precision, i double precision, e double precision, ac double precision, bo double precision, consumo double precision, outros double precision)`.
  - `v_house_daily(day date, g double precision, i double precision, e double precision, ac double precision, bo double precision, consumo double precision, autoconsumo double precision, autossuficiencia double precision, outros double precision)`.
  - Fontes: `g` = `solar_plant`/`energy_total_kwh`; `i` = `grid_meter`/`energy_import_total_kwh`; `e` = `grid_meter`/`energy_export_total_kwh`; `ac` = `appliance_ac`/`energy_total_kwh`; `bo` = `appliance_boiler`/`energy_total_kwh`.
  - Regras: `consumo = g + i − e` (nulo se qualquer um dos três for nulo); `autoconsumo = greatest(g − e, 0)`; `autossuficiencia = least(autoconsumo / consumo, 1)` quando `consumo > 0`, senão 0; `outros = greatest(consumo − coalesce(ac,0) − coalesce(bo,0), 0)`; `ac` e `bo` ficam nulos quando o aparelho não gravou no período.

- [ ] **Step 1: Escrever os testes** em `03_house_views.test.sql`. Montar leituras de um dia local com deltas exatos (primeira leitura do dia como âncora com delta 0):
  - `exemplo da spec` — g = 9,8, i = 4,5, e = 3,1 → `consumo` 11,2; `autoconsumo` 6,7; `autossuficiencia` ≈ 0,5982 (tolerância 0,0001).
  - `outros com ar e boiler` — ac = 3,1 e bo = 2,8 sobre consumo 11,2 → `outros` 5,3.
  - `outros nunca negativo` — ac + bo maiores que o consumo → `outros` = 0.
  - `fonte sem dados vira nulo` — dia sem leituras de `grid_meter` → `i`, `e` e `consumo` nulos (não zero) e `g` preenchido.
  - `aparelho ausente` — sem leituras de `appliance_boiler` → `bo` nulo e `outros` calculado com 0 para o boiler.
  - `consumo zero` — g = 0, i = 0, e = 0 → `autossuficiencia` = 0, sem erro.
  - `autoconsumo limitado` — e > g (dado ruim) → `autoconsumo` = 0 e `autossuficiencia` entre 0 e 1.
  - `por hora` — uma hora com g = 1,0, i = 0,5, e = 0,2 → `consumo` 1,3.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar a migration** pivotando `v_energy_daily`/`v_energy_hourly` com `sum(kwh) filter (where device_id = ... and metric = ...)` agrupado por dia/hora. Para que `sum` devolva nulo (e não 0) quando não há linhas da fonte, usar `max`/`sum` apenas sobre linhas filtradas sem `coalesce`.
- [ ] **Step 4: Rodar:** passa.
- [ ] **Step 5: Commit** `feat(db): house hourly and daily views`.

---

### Task 6: Créditos e boiler fora do sol

**Files:**
- Modify: `supabase/migrations/20261008000300_house_views.sql` (acrescentar ao fim)
- Test: `supabase/tests/04_credits_boiler.test.sql`

**Interfaces:**
- Consumes: `v_energy_daily`, `v_energy_hourly`, `credit_baseline`, `settings`.
- Produces:
  - `v_credits(as_of date, base_kwh double precision, exported_kwh double precision, imported_kwh double precision, balance_kwh double precision, avg_net_drain_kwh_per_day double precision, days_left double precision)`: zero linhas se não houver `credit_baseline`. `base_kwh` vem do baseline de maior `as_of`; `exported_kwh`/`imported_kwh` somam `v_energy_daily` do `grid_meter` nos dias **depois** de `as_of`; `balance_kwh = base_kwh + exported_kwh − imported_kwh`; `avg_net_drain_kwh_per_day` = média de (importado − exportado) por dia nos últimos `settings.credit_trend_days` dias com dados; `days_left = balance_kwh / avg_net_drain_kwh_per_day` só quando a média for positiva, senão nulo.
  - `v_boiler_off_sun(day date, boiler_kwh_off_sun double precision, boiler_kwh_total double precision)`: por dia local, energia do `appliance_boiler` nas horas em que a geração (`solar_plant`) da hora é menor que `settings.solar_low_kwh_per_hour`, e o total do dia.

- [ ] **Step 1: Escrever os testes** em `04_credits_boiler.test.sql`:
  - `sem baseline` — `select count(*) from v_credits` = 0.
  - `saldo do exemplo` — baseline `as_of = 2026-09-30`, `balance_kwh = 217`; exportado 86 e importado 175 nos dias seguintes → `balance_kwh` = 128.
  - `baseline mais recente vence` — dois baselines; usa o de `as_of` maior e ignora energia anterior a ele.
  - `energia do proprio dia do baseline nao conta` — energia no dia `as_of` não entra na soma.
  - `duracao quando o saldo cai` — média de dreno 10 kWh/dia e saldo 128 → `days_left` = 12,8.
  - `duracao nula quando o saldo sobe` — exportado maior que importado → `days_left` nulo (sem erro nem valor negativo).
  - `boiler fora do sol` — boiler 1,4 kWh numa hora com geração 0,0 e 1,0 kWh numa hora com geração 1,5 → `boiler_kwh_off_sun` = 1,4 e `boiler_kwh_total` = 2,4.
  - `limite configuravel` — com `solar_low_kwh_per_hour = '2'`, as duas horas contam como fora do sol.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar as duas views.**
- [ ] **Step 4: Rodar:** passa.
- [ ] **Step 5: Commit** `feat(db): credits balance and boiler off-sun views`.

---

### Task 7: Status do coletor

**Files:**
- Modify: `supabase/migrations/20261008000300_house_views.sql` (acrescentar ao fim)
- Test: `supabase/tests/04_credits_boiler.test.sql` (acrescentar casos)

**Interfaces:**
- Consumes: `collector_runs`.
- Produces: `v_collector_status(source text, ok boolean, started_at timestamptz, age_minutes double precision)`: a rodada mais recente de cada `source`, **sem** `error_message`.

- [ ] **Step 1: Escrever os testes:** `ultima rodada por fonte` (duas rodadas da `solarman`, uma ok e depois uma com erro → a view devolve a mais recente, `ok = false`); `sem mensagem de erro` (consulta `information_schema.columns` e confirma que `error_message` não é coluna da view); `uma linha por fonte` (rodadas de `solarman` e `tuya` → 2 linhas).
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar `v_collector_status`** com `distinct on (source) ... order by source, started_at desc`. Esta view **não** usa `security_invoker`, porque o app não pode ler `collector_runs` (a Tarefa 8 concede acesso só à view).
- [ ] **Step 4: Rodar:** passa.
- [ ] **Step 5: Commit** `feat(db): v_collector_status`.

---

### Task 8: Segurança (RLS e permissões)

**Files:**
- Create: `supabase/migrations/20261008000400_security.sql`
- Test: `supabase/tests/05_security.test.sql`

**Interfaces:**
- Consumes: todas as tabelas e views das tarefas anteriores; papéis `anon`, `authenticated`, `service_role`.
- Produces: RLS ligado em todas as tabelas de `public`; as views `v_energy_deltas`, `v_energy_hourly`, `v_energy_daily`, `v_power_hourly`, `v_now`, `v_house_hourly`, `v_house_daily`, `v_credits`, `v_boiler_off_sun` recriadas ou alteradas com `security_invoker = true`; permissões e políticas descritas abaixo.

Permissões finais: `anon` sem nenhum privilégio no schema `public`. `authenticated`: `select` em `devices`, `readings`, `settings`, `credit_baseline` (com política `using (true)`), `insert`/`update` em `credit_baseline` e `settings`, `select` em todas as views `v_*`. `api_tokens`, `collector_runs` e `device_metric_map`: nenhum privilégio e nenhuma política para `anon` e `authenticated`. `service_role` ignora RLS.

- [ ] **Step 1: Escrever os testes** em `05_security.test.sql` (usar `set local role` e `reset role` dentro da transação; inserir dados como dono antes de trocar de papel):
  - `anon nao le nada` — como `anon`, `test.throws` em `select * from readings` e em `select * from v_now`.
  - `authenticated le views` — como `authenticated`, `select count(*) from v_house_daily` e `from v_credits` não dão erro e `v_now` devolve a leitura inserida.
  - `authenticated nao escreve em readings` — `test.throws` ao inserir em `readings` e ao dar `update`/`delete` nela.
  - `authenticated grava baseline e settings` — `insert` em `credit_baseline` e `update settings` funcionam.
  - `segredos isolados` — como `authenticated`, `test.throws` em `select * from api_tokens` e `select * from collector_runs`.
  - `status do coletor` — como `authenticated`, `select * from v_collector_status` funciona e devolve a rodada inserida pelo dono.
  - `view respeita RLS` — como `authenticated`, `v_now` e `v_energy_daily` funcionam (confirma que `security_invoker` não quebra a leitura legítima).
- [ ] **Step 2: Rodar e ver falhar** (sem a migration, `anon` consegue ler como dono do teste ou os `grant` não existem).
- [ ] **Step 3: Implementar a migration:** `alter table ... enable row level security` em todas as tabelas; `revoke all` de `anon` e `authenticated` em todas as tabelas e views de `public`; os `grant` e `create policy` das permissões finais; `alter view ... set (security_invoker = true)` nas nove views listadas; `grant select on v_collector_status to authenticated`.
- [ ] **Step 4: Rodar:** passa (testes 01 a 05).
- [ ] **Step 5: Commit** `feat(db): row level security and grants`.

---

### Task 9: Dados de demonstração e README final

**Files:**
- Create: `supabase/seed_demo.sql`
- Modify: `README.md`
- Test: `supabase/tests/06_seed_demo.test.sql`

**Interfaces:**
- Consumes: todas as tabelas e views.
- Produces: `supabase/seed_demo.sql`, script idempotente que apaga as leituras de demonstração e grava 30 dias (até hoje) de leituras a cada 5 minutos para os quatro dispositivos, de forma determinística (mesma curva todos os dias, sem aleatoriedade), mais um `credit_baseline` de demonstração. Curvas: geração positiva só entre 6h e 18h locais com pico ao meio-dia; boiler ligado às 6h e 7h; ar-condicionado ligado das 11h às 15h; casa com base noturna constante. Os acumulados crescem sem nunca decrescer.

- [ ] **Step 1: Escrever os testes** em `06_seed_demo.test.sql` (rodam o seed dentro da transação): `trinta dias` (`v_house_daily` tem ao menos 29 dias completos); `identidade do consumo` (para cada dia, `consumo` = `g + i − e` com tolerância 0,001); `outros nao negativo` (nenhuma linha com `outros < 0`); `acumulados monotonicos` (nenhuma linha de `v_energy_deltas` negativa e nenhum decréscimo bruto em `readings` por série); `boiler de manha` (em todo dia, `boiler_kwh_off_sun` > 0 na `v_boiler_off_sun`); `idempotente` (rodar o seed duas vezes não duplica nem muda a contagem de `readings`).
- [ ] **Step 2: Rodar e ver falhar** (arquivo do seed inexistente).
- [ ] **Step 3: Implementar `supabase/seed_demo.sql`** com `generate_series` de 5 em 5 minutos e acumulado por soma de potência × 5/60 ÷ 1000, com `on conflict do nothing`.
- [ ] **Step 4: Rodar:** `scripts/test-db.sh` passa por inteiro, com código 0.
- [ ] **Step 5: Completar `README.md`:** seção "Aplicar no Supabase" (instalar a CLI, `supabase login`, `supabase link`, `supabase db push`, e rodar `seed_demo.sql` no editor SQL só em projeto de teste) e a lista dos planos seguintes (coletor Solarman, coletor Tuya, app, contas de luz).
- [ ] **Step 6: Commit** `feat(db): demo seed and readme`.

---

## Auto-revisão

- **Cobertura da spec (fase 1):** tabelas (T2), energia por hora e dia (T3), `v_now` (T4), views da casa (T5), créditos e boiler (T6), `v_collector_status` (T7), RLS e permissões (T8), dados de teste (T9). Ficam fora, por decisão do escopo: `bills`/`v_bill_check` (plano das contas de luz), coletor, app e importação de histórico.
- **Consistência de nomes:** `v_energy_hourly`/`v_energy_daily` (T3) são consumidas por T5 e T6; `settings` (T2) é consumida por T4 (`stale_after_minutes`), T6 (`solar_low_kwh_per_hour`, `credit_trend_days`).
- **Proporção:** o plano descreve interfaces e asserções, não o corpo das views.
