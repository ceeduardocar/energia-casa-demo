# Energia Casa — Plano 3: coletor Tuya

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Goal:** Gravar no Supabase, a cada 5 minutos e nas 24 horas, a potência e a energia acumulada do medidor geral (Breaker) e dos canais A (ar-condicionado) e B (boiler) do Smart Meter, com o mapeamento em `device_metric_map` e sem nenhum segredo no repositório, no app ou no chat.

**Architecture:** O coletor `collect` (Deno) ganha uma segunda fonte, `tuya`, que roda junto com a `solarman` na mesma rodada. A Tuya é lida pelo endpoint `GET /v2.0/cloud/thing/{id}/shadow/properties`, que devolve todos os códigos do medidor (inclusive os de canal, `power_a`, `forward_energy_1` e outros). O endpoint `GET /v1.0/devices/{id}/status` **não** serve: traz só os totais. A tradução código → métrica fica em `device_metric_map`, não no código. A lógica fica em módulos TypeScript puros, testados com `node --test`, como no plano 2.

**Tech Stack:** TypeScript (só sintaxe apagável), Deno (Supabase Edge Runtime), Node 24 para os testes, `node:crypto` (HMAC-SHA256), SQL.

**Spec:** `docs/superpowers/specs/2026-10-08-energia-casa-design.md` (seções 4.2, 5, 6, 7, 9, 10 e fase 3 da seção 11). Plano anterior: `docs/superpowers/plans/2026-10-09-energia-casa-plano-2-coletor-solarman.md`.

**Escopo:** coletor Tuya, mapeamento e agendamento de 24 h. **Fora deste plano:** generalizar as views por aparelho (`v_house_hourly`, `v_house_daily`, tela Aparelhos lida de `devices`). Isso é o "plano 4" de `CLAUDE.md` e precisa de decisão própria, porque muda o app. Não muda as views nem o app aqui.

## O que a API da Tuya devolveu de verdade (testes de 2026-10-12)

Conferido com `scripts/tuya-check.mjs` e consultas avulsas, com as chaves do `.env.tuya`. Os testes usam respostas com este formato (ver fixture na Tarefa 1).

- Projeto: "energia-casa", Smart Home, data center Western America, base `https://openapi.tuyaus.com`.
- `GET /v1.0/token?grant_type=1` → `result.access_token`, `result.expire_time` (segundos, cerca de 7200 s). Assinado sem token.
- `GET /v2.0/cloud/thing/{id}/shadow/properties` → `result.properties[]`, cada item com `code`, `value`, `time` (epoch em **ms**, o último relato daquele código) e `dp_id`. Este é o endpoint de leitura.
- `GET /v2.0/cloud/thing/{id}/model` → escala (`typeSpec.scale`) e unidade de cada código.
- `GET /v1.0/iot-03/devices/{id}/status` e `GET /v1.0/devices/{id}/status` → só os 3 totais do Smart Meter. **Não usar.**
- `GET /v1.0/devices/{id}/functions` → código 2009 "not support this device". **Não usar.**

**Medidor geral** (`Breaker`, categoria `dlq`, id `demo_grid_meter_0001`), códigos de interesse:

| código | unidade (modelo) | escala | significado |
|---|---|---|---|
| `power_total` | kW | 3 | potência total; valor bruto em W |
| `total_forward_energy` | kW·h | 2 | importado acumulado |
| `reverse_energy_total` | kW·h | 2 | exportado acumulado |

Valores de 2026-10-12 (bruto): `total_forward_energy` 119 (1,19 kWh), `reverse_energy_total` 193 (1,93 kWh).

**Medidor de aparelhos** (`Smart Meter`, modelo `DY_SMART_METER_01_T1U`, id `demo_appl_meter_0002`), dois canais, canal A no ar-condicionado e canal B no boiler, ligados na fase da solar:

| código | canal | unidade (modelo) | escala |
|---|---|---|---|
| `power_a` / `power_b` | A / B | W | 1 (bruto ÷ 10) |
| `forward_energy_1` / `forward_energy_2` | A / B | kW·h | 2 (bruto ÷ 100) |
| `reverse_energy_1` / `reverse_energy_2` | A / B | kW·h | 2 |
| `power_total` | soma | W | 1 (é A + B) |

Conferido no app Smart Meter com o ar ligado: canal A 59,4 W, total 60,1 W, canal B 0,9 W. Logo o canal A é o ar-condicionado.

## Decisões deste plano (desvios e acréscimos à spec)

1. **Leitura pelo `shadow/properties`.** O `/v1.0/devices/{id}/status` esconde os canais. Com o shadow, uma chamada por medidor traz tudo.
2. **`ts` vem do `time` de cada código** (ms → epoch s, arredondado para baixo a 5 min), e não da hora da coleta. Assim, um código que não mudou não cria linha nova, e a escrita idempotente cuida do resto (mesmo princípio do plano 2, decisão 1).
3. **Sentido do medidor geral.** `power_w` grava o módulo (convenção da spec, seção 5). Forward = importado, reverse = exportado. A confirmação do sentido é o critério de aceite da Tarefa 7, contra o relógio medidor.
4. **Canais do Smart Meter viram `appliance_ac` (canal A) e `appliance_boiler` (canal B)**, que já existem em `devices`. Não se cria aparelho novo aqui.
5. **Potência negativa no Smart Meter é descartada** (aparelho não gera). No medidor geral, potência negativa é aceita e vira módulo.
6. **Agenda de 24 horas.** O `cron_collect` passa a `*/5 * * * *`. A janela diurna da Solarman (07:00–18:55 de Brasília) vira regra dentro da função: fora dela, a fonte `solarman` não roda ao vivo e não grava linha em `collector_runs`. O `cron_backfill` continua valendo para o backfill noturno da Solarman.
7. **Uma chamada por medidor por rodada**, mais um token a cada ~2 horas (o token da Tuya vale cerca de 120 minutos, então renovar com 10 minutos de folga). Conta: 2 chamadas × 288 rodadas por dia = 576 por dia, mais ~12 tokens.
8. **Mapeamento como dados, não como código.** `supabase/tuya_map.sql` preenche `device_metric_map` (source `tuya`, `external_id` = id do medidor, `source_code` = código Tuya, `scale` = fator bruto → unidade interna). Os IDs são de dispositivo, não segredo, mas ficam fora do código: o SQL é rodado à mão, como os `cron_*.sql`.
9. **Segredos.** `TUYA_CLIENT_ID`, `TUYA_SECRET` e `TUYA_BASE` vão para o cofre do Supabase via `.env.supabase`, gerado pelo `scripts/make-supabase-secrets.mjs` a partir de `.env.solarman` e `.env.tuya`.

## Global Constraints

- Coletor **somente leitura** na Tuya: só `GET` (token e shadow).
- Cota: verificar no painel da Tuya antes da Tarefa 6 que o limite comporta cerca de 600 chamadas por dia. A assinatura de teste do projeto expira em **08/11/2026**; renovar antes disso.
- `readings`: `ts` sempre múltiplo de 5 min (UTC), escrita com `ON CONFLICT DO NOTHING` (`upsert` com `ignoreDuplicates: true`), em lotes de até 1.000 linhas.
- `power_w` é sempre ≥ 0, inclusive no `grid_meter` (módulo).
- Dias e "janela da Solarman" sempre em `America/Sao_Paulo` (`Intl` com `timeZone`).
- Nenhum valor de segredo em código, testes, logs, `error_message` nem no chat. Mensagens de erro citam o caminho sem a query (`/v2.0/cloud/thing/…/shadow/properties`), nunca o `sign`, o `access_token` nem o secret.
- Módulos em `supabase/functions/collect/`: só sintaxe TypeScript apagável (sem `enum`, `namespace` nem parameter properties), imports com extensão `.ts` e `import type` para tipos, para rodar igual no Deno e no Node 24.
- Tempo limite por fonte: 25 s para a coleta ao vivo (igual ao plano 2). Falha numa fonte não impede a outra.
- Commits com a identidade do repo: `git commit ...` (sem alterar a config global).

## Review Focus

1. Shadow sem um dos códigos mapeados (ex.: `power_b` ausente): a rodada grava os outros, anota o código faltante e não lança erro. (Tarefa 2)
2. Potência negativa no canal A (aparelho): descartada e anotada; no `grid_meter`, a mesma potência negativa vira módulo. (Tarefa 2)
3. Token recusado pela Tuya: renova uma vez e tenta de novo; se a renovação falhar, registra erro e para (sem laço). (Tarefa 1)
4. Assinatura de teste vencida (resposta da Tuya com `success:false`): `error_message` claro com código e mensagem, e a Solarman continua rodando na mesma rodada. (Tarefas 3 e 5)
5. Contador que diminui (medidor zerado ou trocado): a leitura é gravada e anotada, sem derrubar a rodada. (Tarefa 2)
6. Rodada repetida com o mesmo `time` do shadow: 0 linhas novas, sem erro. (Tarefa 2)
7. Madrugada: a Tuya continua coletando e a Solarman não roda ao vivo nem grava `collector_runs`. (Tarefa 3)

---

### Tarefa 1: Cliente Tuya (assinatura, token e shadow)

**Files:**
- Create: `supabase/functions/collect/tuya.ts`
- Create: `supabase/functions/collect/tests/fixtures/tuya-shadow.json` (resposta real do shadow do Smart Meter, com IDs e `owner_id`/`uid` trocados por valores fictícios)
- Create: `supabase/functions/collect/tests/tuya.test.ts`
- Modify: `supabase/functions/collect/types.ts` (tipos da Tuya, ver Interfaces)

**Interfaces:**
- Consumes: `FetchFn`, `Db`, `Clock` de `types.ts`.
- Produces:
  - `export type TuyaEnv = { clientId: string; secret: string; base: string }`
  - `export type TuyaProperty = { code: string; value: unknown; time: number }`
  - `export interface Tuya { shadow(deviceId: string): Promise<TuyaProperty[]> }`
  - `export function sign(opts: { clientId: string; secret: string; t: string; method: string; path: string; token?: string }): string` — HMAC-SHA256 em maiúsculas.
  - `export function createTuya(opts: { fetch: FetchFn; db: Db; clock: Clock; env: TuyaEnv }): Tuya`

- [ ] **Passo 1: Escrever os testes que fixam a assinatura**

Em `tests/tuya.test.ts`, com `node:test`:

```ts
test("sign: HMAC-SHA256 do client_id + token + t + stringToSign, em maiúsculas", () => {
  const s = sign({ clientId: "cid", secret: "sec", t: "1700000000000", method: "GET", path: "/v1.0/token?grant_type=1" });
  assert.equal(s, EXPECTED_SIGN); // calcular uma vez com a fórmula da scripts/tuya-check.mjs e colar o valor aqui
  assert.match(s, /^[0-9A-F]{64}$/);
});
test("sign: com token, o token entra na string antes do t", () => { /* valor fixo diferente */ });
```

Os valores `EXPECTED_SIGN` são calculados uma vez com a mesma fórmula de `scripts/tuya-check.mjs` (fora do repo, em `$TMPDIR`), e colados no teste. Esse é o único lugar em que o teste precisa de um número de referência.

- [ ] **Passo 2: Rodar e ver falhar**

Run: `node --test "supabase/functions/collect/tests/tuya.test.ts"`
Expected: FAIL com "sign is not a function" (ou erro de módulo não encontrado).

- [ ] **Passo 3: Implementar `sign`, o token e o `shadow` em `tuya.ts`**

- `sign`: `stringToSign = [method, sha256hex(""), "", path].join("\n")`; `str = clientId + (token ?? "") + t + stringToSign`; HMAC-SHA256 com `secret`, hex maiúsculo.
- Cabeçalhos: `client_id`, `sign`, `t` (epoch ms como string), `sign_method: "HMAC-SHA256"`, e `access_token` quando houver token.
- Token: `db.getToken("tuya")`. Se `expires_at` estiver a mais de 10 minutos, usa o token salvo. Senão, `GET /v1.0/token?grant_type=1`, salva com `db.saveToken("tuya", token, now + expire_time·1000 − 10 min)`.
- `shadow(deviceId)`: `GET /v2.0/cloud/thing/{id}/shadow/properties` com o token, devolve `result.properties`.
- Erro de token (`code` 1010): renova uma vez (busca token novo sem usar o salvo) e repete o `shadow`. Se falhar de novo, lança erro com `code` e `msg`.
- Qualquer outra resposta com `success:false` lança `Error("<caminho sem query>: code=… msg=…")`.

- [ ] **Passo 4: Testes do cliente com `fakeFetch`**

Casos a cobrir: token salvo válido não chama `/token`; token vencendo chama `/token` e salva; `code 1010` renova uma vez e tem sucesso; `code 1010` duas vezes lança erro (sem terceira chamada); `success:false` com outro código lança erro com código e mensagem, sem secret na mensagem.

- [ ] **Passo 5: Rodar e ver passar**

Run: `node --test "supabase/functions/collect/tests/tuya.test.ts"`
Expected: PASS em todos.

- [ ] **Passo 6: Commit**

```bash
git add supabase/functions/collect/tuya.ts supabase/functions/collect/types.ts supabase/functions/collect/tests/tuya.test.ts supabase/functions/collect/tests/fixtures/tuya-shadow.json
git commit -m "feat(collect): cliente Tuya (assinatura, token e shadow)"
```

---

### Tarefa 2: Coleta Tuya ao vivo (shadow → leituras)

**Files:**
- Create: `supabase/functions/collect/tuya_live.ts`
- Create: `supabase/functions/collect/tests/tuya_live.test.ts`
- Modify: `supabase/functions/collect/types.ts` (`Db.metricMap`, ver Interfaces)

**Interfaces:**
- Consumes: `Tuya` e `TuyaProperty` (Tarefa 1); `bin5` de `time.ts`.
- Produces:
  - `export type MapRow = { external_id: string; source_code: string; device_id: string; metric: string; scale: number }`
  - `Db.metricMap(source: string): Promise<MapRow[]>` (adicionado ao `Db`)
  - `export async function collectTuya(opts: { tuya: Tuya; db: Db; maxPowerW: number }): Promise<{ written: number; notes: string[] }>`

- [ ] **Passo 1: Escrever os testes de conversão e validação**

Em `tests/tuya_live.test.ts`, com um `Db` em memória (dublê) e um `Tuya` falso que devolve as propriedades da fixture:

```ts
test("canal A do Smart Meter vira appliance_ac: power_w = power_a × 0,1 e energy_total_kwh = forward_energy_1 × 0,01", ...);
test("Breaker: power_total em W, potência negativa vira módulo; total_forward_energy vira energy_import_total_kwh", ...);
test("Smart Meter: potência negativa é descartada e anotada", ...);
test("código ausente no shadow: grava os outros e anota, sem lançar erro", ...);
test("time em ms vira ts arredondado a 5 min; mesmo time em duas rodadas grava 0 linhas na segunda", ...);
test("potência acima de maxPowerW é descartada e anotada", ...);
```

Valores esperados vêm da fixture `tuya-shadow.json`: por exemplo `power_a` bruto 18 → `power_w` 1,8 W.

- [ ] **Passo 2: Rodar e ver falhar**

Run: `node --test "supabase/functions/collect/tests/tuya_live.test.ts"`
Expected: FAIL (módulo `tuya_live.ts` não existe).

- [ ] **Passo 3: Implementar `collectTuya`**

Para cada `external_id` distinto em `db.metricMap("tuya")`, chama `tuya.shadow(external_id)` uma vez. Para cada linha do mapa com esse `external_id`:
- Acha a propriedade com `code === source_code`. Se não achar: anota `"código ausente: <source_code>"` e segue.
- `value` precisa ser número. Senão, anota e segue.
- `converted = value × scale`.
- Se `metric === "power_w"`: se `device_id === "grid_meter"`, usa `|converted|`; se `converted < 0` em outro aparelho, anota e descarta; se `> maxPowerW`, anota e descarta.
- Se `metric` for energia acumulada e `converted < 0`, anota e descarta. Se for menor que a última leitura gravada (`db.lastReading`), anota `"total diminuiu: …"` e grava mesmo assim.
- `ts = bin5(time / 1000)`.
- Junta as linhas e chama `db.insertReadings` uma vez por rodada.

Erro de rede ou de token deixa de ser anotado aqui: propaga para o `runAll`, que registra a falha da fonte.

- [ ] **Passo 4: Rodar e ver passar**

Run: `node --test "supabase/functions/collect/tests/tuya_live.test.ts"`
Expected: PASS em todos.

- [ ] **Passo 5: Commit**

```bash
git add supabase/functions/collect/tuya_live.ts supabase/functions/collect/tests/tuya_live.test.ts supabase/functions/collect/types.ts
git commit -m "feat(collect): coleta Tuya ao vivo a partir do shadow e do mapa"
```

---

### Tarefa 3: Agendamento por fonte (Solarman só na janela diurna)

**Files:**
- Modify: `supabase/functions/collect/run.ts` (Step pode devolver `null` = não devido)
- Modify: `supabase/functions/collect/tests/run.test.ts`
- Modify: `supabase/functions/collect/time.ts` (`inSolarWindow(epochMs): boolean`, janela 07:00–18:55 de Brasília)
- Create: `supabase/functions/collect/tests/window.test.ts` (ou acrescentar em `time.test.ts`)

**Interfaces:**
- Consumes: `localTime`, `TZ` de `time.ts`.
- Produces:
  - `export type Step = () => Promise<{ written: number; notes: string[] } | null>` — `null` significa "não devido nesta rodada": não grava em `collector_runs` se também não houver backfill.
  - `export function inSolarWindow(epochMs: number): boolean` — verdadeiro entre 07:00 e 18:55 locais (inclusive).

- [ ] **Passo 1: Testes**

```ts
test("inSolarWindow: 06:55 falso, 07:00 verdadeiro, 18:55 verdadeiro, 19:00 falso (America/Sao_Paulo)", ...);
test("runAll: live que devolve null não grava em collector_runs", ...);
test("runAll: Tuya falha e Solarman segue; a falha da Tuya fica em collector_runs com a mensagem", ...);
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `node --test "supabase/functions/collect/tests/window.test.ts" "supabase/functions/collect/tests/run.test.ts"`
Expected: FAIL nos casos novos.

- [ ] **Passo 3: Implementar**

- `inSolarWindow`: hora e minuto locais via `Intl` com `timeZone: TZ`; minutos do dia entre 420 (07:00) e 1135 (18:55), inclusive.
- `runAll`: se `live()` devolve `null`, não soma notas nem marca falha; se nada for gravado e não houver notas do backfill, pula o `logRun`.

- [ ] **Passo 4: Rodar e ver passar**

Run: `node --test "supabase/functions/collect/tests/*.test.ts"`
Expected: PASS em todos os testes da pasta (inclusive os do plano 2).

- [ ] **Passo 5: Commit**

```bash
git add supabase/functions/collect/run.ts supabase/functions/collect/time.ts supabase/functions/collect/tests/
git commit -m "feat(collect): fontes com agenda própria; Solarman só na janela diurna"
```

---

### Tarefa 4: Mapeamento no banco

**Files:**
- Create: `supabase/tuya_map.sql` (rodar à mão, como os `cron_*.sql`; idempotente)
- Modify: `supabase/functions/collect/index.ts` (implementa `db.metricMap`)

**Interfaces:**
- Consumes: tabela `device_metric_map` (migration `20261008000100_core_tables.sql`).
- Produces: linhas `source = 'tuya'` com a chave `(source, external_id, source_code)`.

- [ ] **Passo 1: Escrever o SQL**

```sql
insert into public.device_metric_map (source, external_id, source_code, device_id, metric, scale) values
  ('tuya', 'demo_grid_meter_0001', 'power_total',           'grid_meter',      'power_w',                   1),
  ('tuya', 'demo_grid_meter_0001', 'total_forward_energy',  'grid_meter',      'energy_import_total_kwh',   0.01),
  ('tuya', 'demo_grid_meter_0001', 'reverse_energy_total',  'grid_meter',      'energy_export_total_kwh',   0.01),
  ('tuya', 'demo_appl_meter_0002', 'power_a',               'appliance_ac',    'power_w',                   0.1),
  ('tuya', 'demo_appl_meter_0002', 'forward_energy_1',      'appliance_ac',    'energy_total_kwh',          0.01),
  ('tuya', 'demo_appl_meter_0002', 'power_b',               'appliance_boiler','power_w',                   0.1),
  ('tuya', 'demo_appl_meter_0002', 'forward_energy_2',      'appliance_boiler','energy_total_kwh',          0.01)
on conflict (source, external_id, source_code) do nothing;
```

- [ ] **Passo 2: Implementar `db.metricMap` em `index.ts`**

`select external_id, source_code, device_id, metric, scale from device_metric_map where source = $1`, via service role, com o mesmo `must(...)` das outras funções.

- [ ] **Passo 3: Verificar no banco**

Run: `supabase db query --linked "select device_id, metric, source_code, scale from public.device_metric_map where source='tuya' order by 1,2"`
Expected: 7 linhas, na ordem acima.

- [ ] **Passo 4: Commit**

```bash
git add supabase/tuya_map.sql supabase/functions/collect/index.ts
git commit -m "feat(db): mapa Tuya (medidor geral e canais A/B)"
```

---

### Tarefa 5: Ligação na função e segredos

**Files:**
- Modify: `supabase/functions/collect/index.ts` (fonte `tuya` na lista e checagem de segredos)
- Modify: `scripts/make-supabase-secrets.mjs` (lê `.env.tuya` além de `.env.solarman`)

**Interfaces:**
- Consumes: `createTuya`, `collectTuya`, `inSolarWindow`, `db.metricMap`.
- Produces: `.env.supabase` com `TUYA_CLIENT_ID`, `TUYA_SECRET`, `TUYA_BASE`.

- [ ] **Passo 1: Estender o script de segredos**

`make-supabase-secrets.mjs` lê `.env.tuya` (`TUYA_CLIENT_ID`, `TUYA_SECRET`, `TUYA_BASE`, com padrão `https://openapi.tuyaus.com`). Não imprime valores, como hoje. Erro se faltar campo, citando só os nomes.

- [ ] **Passo 2: Gerar e subir os segredos**

Run: `node scripts/make-supabase-secrets.mjs && supabase secrets set --env-file .env.supabase`
Expected: "Finished supabase secrets set." Nenhum valor no terminal.

- [ ] **Passo 3: Ligar a fonte em `index.ts`**

- Checa `TUYA_CLIENT_ID` e `TUYA_SECRET` junto com as de Solarman (mesmo caminho de "secret ausente").
- Na lista de `sources`, adiciona `{ name: "tuya", live: () => collectTuya({ tuya, db, maxPowerW: 6000 }) }`, com o mesmo `maxPowerW` do Solarman (`solar_max_power_w` para a Solarman; Tuya usa o `maxPowerW` fixo de 6000 W para o medidor geral, por ora).
- A Solarman passa a `live: async () => (inSolarWindow(Date.now()) ? collectLive(...) : null)`.
- Modo `backfill` continua pulando a coleta ao vivo de todas as fontes.

- [ ] **Passo 4: Testes locais**

Run: `node --test "supabase/functions/collect/tests/*.test.ts"`
Expected: PASS em todos.

- [ ] **Passo 5: Commit**

```bash
git add supabase/functions/collect/index.ts scripts/make-supabase-secrets.mjs
git commit -m "feat(collect): liga a fonte Tuya e os segredos"
```

---

### Tarefa 6: Publicar e agendar 24 horas

**Files:**
- Modify: `supabase/cron_collect.sql` (janela de cron passa a `*/5 * * * *`)

- [ ] **Passo 1: Publicar a função**

Run: `supabase functions deploy collect --no-verify-jwt` (o mesmo comando do plano 2).
Expected: "Deployed Functions on project <PROJECT_REF>: collect".

- [ ] **Passo 2: Disparo manual, uma rodada**

Run: `supabase db query --linked "select public.collect_trigger()"` e depois, no SQL, `select source, ok, readings_written, error_message from public.collector_runs order by id desc limit 4`.
Expected: linhas `tuya` com `ok = true` e `readings_written` ≥ 0; a Solarman só aparece se a rodada for de dia.

- [ ] **Passo 3: Reagendar**

Trocar no `cron_collect.sql` a expressão para `*/5 * * * *` (o nome do job não muda) e rodar o bloco de agendamento à mão no SQL.
Run: `supabase db query --linked "select jobname, schedule from cron.job"`
Expected: o job `collect` com `*/5 * * * *`.

- [ ] **Passo 4: Commit**

```bash
git add supabase/cron_collect.sql
git commit -m "chore(collect): agenda de 5 min nas 24 horas (janela da Solarman na função)"
```

---

### Tarefa 7: Aceite (24 horas e sentido do medidor)

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-energia-casa-design.md` (seção 11, fase 3: registrar a data e o resultado; seção 4.2: shadow e mapa)

- [ ] **Passo 1: Conferir 24 horas sem buraco**

Run: `supabase db query --linked "select device_id, metric, count(*) as n, min(ts), max(ts) from public.readings where device_id in ('grid_meter','appliance_ac','appliance_boiler') and ts > now() - interval '24 hours' group by 1,2 order by 1,2"`
Expected: `power_w` dos três dispositivos com leituras a cada 5 min (a potência do ar e do boiler pode ficar em 0 W sem contar como buraco; conferir o `time` do shadow, que só muda quando o valor muda).

- [ ] **Passo 2: Conferir o sentido do medidor geral**

Comparar `energy_import_total_kwh` e `energy_export_total_kwh` do `grid_meter` com a leitura do relógio do medidor no mesmo horário, em duas leituras separadas por algumas horas. Se estiver invertido, corrigir `scale` negativo ou trocar as métricas no `tuya_map.sql` (sem mexer no código).
Expected: diferenças dentro da margem do relógio; registrar a data e o resultado.

- [ ] **Passo 3: Registrar na spec**

Na seção 11, fase 3: data do aceite, resultado e os desvios deste plano (shadow, mapa, agenda de 24 h). Na seção 4.2, trocar a menção ao status pelo shadow.

- [ ] **Passo 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-08-energia-casa-design.md
git commit -m "docs: coletor Tuya no ar; decisões do plano 3 na spec"
```
