import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { MapRow, Reading } from "../types.ts";
import type { Tuya, TuyaProperty } from "../tuya.ts";
import { collectTuya } from "../tuya_live.ts";
import { memDb } from "./fakes.ts";

const AC_ID = "demo_appl_meter_0002";
const GRID_ID = "demo_grid_meter_0001";
const MAP: MapRow[] = [
  { external_id: GRID_ID, source_code: "power_total", device_id: "grid_meter", metric: "power_w", scale: 1 },
  { external_id: GRID_ID, source_code: "total_forward_energy", device_id: "grid_meter", metric: "energy_import_total_kwh", scale: 0.01 },
  { external_id: GRID_ID, source_code: "reverse_energy_total", device_id: "grid_meter", metric: "energy_export_total_kwh", scale: 0.01 },
  { external_id: AC_ID, source_code: "power_a", device_id: "appliance_ac", metric: "power_w", scale: 0.1 },
  { external_id: AC_ID, source_code: "forward_energy_1", device_id: "appliance_ac", metric: "energy_total_kwh", scale: 0.01 },
  { external_id: AC_ID, source_code: "power_b", device_id: "appliance_boiler", metric: "power_w", scale: 0.1 },
  { external_id: AC_ID, source_code: "forward_energy_2", device_id: "appliance_boiler", metric: "energy_total_kwh", scale: 0.01 },
];
// 1791816198089 ms cai no passo de 5 min 1791816000 s = 2026-10-12T14:40:00Z.
const T = 1791816198089;
const TS = "2026-10-12T14:40:00.000Z";

const prop = (code: string, value: unknown, time = T): TuyaProperty => ({ code, value, time });
const GRID_OK = [prop("power_total", 0), prop("total_forward_energy", 0, T), prop("reverse_energy_total", 0, T - 1)];
/** Fake do cliente Tuya: devolve o shadow de cada medidor (o medidor geral sai zerado, salvo se pedido). */
const fakeTuya = (byDevice: Record<string, TuyaProperty[] | Error>): Tuya => ({
  async shadow(id) {
    const r = byDevice[id] ?? (id === GRID_ID ? GRID_OK : []);
    if (r instanceof Error) throw r;
    return r;
  },
});
const rows = (m: ReturnType<typeof memDb>, device: string, metric: string): Reading[] =>
  [...m.readings.values()].filter((r) => r.device_id === device && r.metric === metric);

test("canal A vira appliance_ac: power_w = bruto × 0,1 e energy_total_kwh = bruto × 0,01", async () => {
  const m = memDb({ map: MAP });
  const tuya = fakeTuya({ [AC_ID]: [prop("power_a", 18), prop("forward_energy_1", 250)] });
  const r = await collectTuya({ tuya, db: m.db, maxPowerW: 6000 });
  assert.equal(r.written, 6); // 4 do medidor geral (inclui potência assinada) + 2 do canal A
  assert.deepEqual(rows(m, "appliance_ac", "power_w"), [{ device_id: "appliance_ac", metric: "power_w", ts: TS, value: 1.8 }]);
  assert.deepEqual(rows(m, "appliance_ac", "energy_total_kwh"), [{ device_id: "appliance_ac", metric: "energy_total_kwh", ts: TS, value: 2.5 }]);
  assert.deepEqual(r.notes, ["código ausente: power_b", "código ausente: forward_energy_2"]);
});

test("medidor geral: power_total em W, importado e exportado em kWh; potência negativa vira módulo", async () => {
  const m = memDb({ map: MAP });
  const tuya = fakeTuya({ [GRID_ID]: [prop("power_total", 27), prop("total_forward_energy", 119, T - 60_000), prop("reverse_energy_total", 193, T)] });
  await collectTuya({ tuya, db: m.db, maxPowerW: 6000 });
  assert.equal(rows(m, "grid_meter", "power_w")[0].value, 27);
  assert.equal(rows(m, "grid_meter", "power_signed_w")[0].value, -27);
  assert.equal(rows(m, "grid_meter", "energy_import_total_kwh")[0].value, 1.19);
  assert.equal(rows(m, "grid_meter", "energy_export_total_kwh")[0].value, 1.93);
});

test("medidor geral: sinal positivo identifica importação da rede", async () => {
  const m = memDb({ map: MAP });
  const tuya = fakeTuya({ [GRID_ID]: [prop("power_total", 437), prop("total_forward_energy", 119, T), prop("reverse_energy_total", 193, T - 60_000)] });
  await collectTuya({ tuya, db: m.db, maxPowerW: 6000 });
  assert.equal(rows(m, "grid_meter", "power_w")[0].value, 437);
  assert.equal(rows(m, "grid_meter", "power_signed_w")[0].value, 437);
});

test("medidor geral: tempos iguais nao inventam um sentido para a rede", async () => {
  const m = memDb({ map: MAP });
  const tuya = fakeTuya({ [GRID_ID]: [prop("power_total", 80), prop("total_forward_energy", 119), prop("reverse_energy_total", 193)] });
  const r = await collectTuya({ tuya, db: m.db, maxPowerW: 6000 });
  assert.equal(rows(m, "grid_meter", "power_w")[0].value, 80);
  assert.equal(rows(m, "grid_meter", "power_signed_w").length, 0);
  assert.match(r.notes.join(" "), /sentido instantaneo da rede indisponivel/);
});

test("potência negativa no canal (aparelho) é gravada como 0 W, sem anotação", async () => {
  // Aparelho desligado: o medidor mostra um negativo pequeno (ex.: -4,1 W). Descartar
  // congelava o app na última leitura ligada.
  const m = memDb({ map: MAP });
  const tuya = fakeTuya({ [AC_ID]: [prop("power_a", -5), prop("forward_energy_1", 250)] });
  const r = await collectTuya({ tuya, db: m.db, maxPowerW: 6000 });
  assert.deepEqual(rows(m, "appliance_ac", "power_w").map((x) => x.value), [0]);
  assert.equal(rows(m, "appliance_ac", "energy_total_kwh").length, 1);
  assert.ok(!r.notes.some((n) => /negativa/.test(n)));
});

test("aparelho abaixo do mínimo de potência é interferência: grava 0 W; acima, grava o valor", async () => {
  const m = memDb({ map: MAP });
  const tuya = fakeTuya({ [AC_ID]: [prop("power_a", 327), prop("power_b", 600)] }); // 32,7 W e 60 W
  await collectTuya({ tuya, db: m.db, maxPowerW: 6000, applianceMinW: 50 });
  assert.deepEqual(rows(m, "appliance_ac", "power_w").map((x) => x.value), [0]);
  assert.deepEqual(rows(m, "appliance_boiler", "power_w").map((x) => x.value), [60]);
});

test("o mínimo de potência dos aparelhos não mexe no medidor geral", async () => {
  const m = memDb({ map: MAP });
  const tuya = fakeTuya({ [GRID_ID]: [prop("power_total", 20), prop("total_forward_energy", 119, T), prop("reverse_energy_total", 193, T - 60_000)] });
  await collectTuya({ tuya, db: m.db, maxPowerW: 6000, applianceMinW: 50 });
  assert.equal(rows(m, "grid_meter", "power_w")[0].value, 20);
});

test("código ausente no shadow: grava os outros, anota e não lança erro", async () => {
  const m = memDb({ map: MAP });
  const tuya = fakeTuya({ [AC_ID]: [prop("power_a", 18), prop("forward_energy_1", 250)] });
  const r = await collectTuya({ tuya, db: m.db, maxPowerW: 6000 });
  assert.equal(r.written, 6);
  assert.deepEqual(r.notes, ["código ausente: power_b", "código ausente: forward_energy_2"]);
});

test("potência acima de maxPowerW é descartada e anotada", async () => {
  const m = memDb({ map: MAP });
  const tuya = fakeTuya({ [AC_ID]: [prop("power_a", 70000)] });
  const r = await collectTuya({ tuya, db: m.db, maxPowerW: 6000 });
  assert.equal(rows(m, "appliance_ac", "power_w").length, 0);
  assert.match(r.notes.join(" "), /potência fora da faixa: power_a 7000 W/);
});

test("mesmo time em duas rodadas: a segunda grava 0 linhas, sem erro", async () => {
  const m = memDb({ map: MAP });
  const tuya = fakeTuya({ [AC_ID]: [prop("power_a", 18), prop("forward_energy_1", 250)] });
  await collectTuya({ tuya, db: m.db, maxPowerW: 6000 });
  const again = await collectTuya({ tuya, db: m.db, maxPowerW: 6000 });
  assert.equal(again.written, 0);
  assert.deepEqual(again.notes, ["código ausente: power_b", "código ausente: forward_energy_2"]);
});

test("contador que diminui: a leitura é gravada e anotada", async () => {
  const m = memDb({ map: MAP });
  await collectTuya({ tuya: fakeTuya({ [AC_ID]: [prop("forward_energy_1", 250, T)] }), db: m.db, maxPowerW: 6000 });
  const r = await collectTuya({ tuya: fakeTuya({ [AC_ID]: [prop("forward_energy_1", 200, T + 600_000)] }), db: m.db, maxPowerW: 6000 });
  assert.equal(r.written, 1);
  assert.match(r.notes.join(" "), /total diminuiu: forward_energy_1 2.5 -> 2/);
});

test("erro do shadow sobe para quem chama (a Solarman não é afetada aqui)", async () => {
  const m = memDb({ map: MAP });
  await assert.rejects(collectTuya({ tuya: fakeTuya({ [AC_ID]: new Error("tempo esgotado") }), db: m.db, maxPowerW: 6000 }), /tempo esgotado/);
});

test("a fixture real do shadow tem todos os códigos do mapa", () => {
  const f = JSON.parse(readFileSync(new URL("./fixtures/tuya-shadow.json", import.meta.url), "utf8")) as { properties: TuyaProperty[] };
  const codes = new Set(f.properties.map((p) => p.code));
  for (const m of MAP.filter((x) => x.external_id === AC_ID)) assert.ok(codes.has(m.source_code), m.source_code);
});
