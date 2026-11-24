import { test } from "node:test";
import assert from "node:assert/strict";
import { backfillStep, buildDay } from "../backfill.ts";
import { fixedClock, memDb } from "./fakes.ts";
import { addDays, localTime } from "../time.ts";
import type { DailyItem, Frame, Solarman } from "../types.ts";

const ep = (iso: string) => Date.parse(iso) / 1000;
const GRID = (ts: string) => Date.parse(ts) % 300000 === 0;

/** Quadros de 5 min num dia local, de hh:mm a hh:mm, com potência dada por função. */
function framesOf(day: string, from: string, to: string, w: (i: number, n: number) => number): Frame[] {
  const a = ep(localTime(day, from)), b = ep(localTime(day, to));
  const n = (b - a) / 300 + 1;
  return Array.from({ length: n }, (_, i) => ({ dateTime: a + i * 300, generationPower: w(i, n) }));
}
const energy = (rows: { metric: string; value: number; ts: string }[]) => rows.filter((r) => r.metric === "energy_total_kwh");

test("buildDay: potência constante, último valor = base + diário, crescente e na grade", () => {
  const fr = framesOf("2026-10-08", "10:00", "12:00", () => 1000);
  const { rows, end } = buildDay({ day: "2026-10-08", frames: fr, dailyKwh: 2, base: 100 });
  const e = energy(rows);
  assert.equal(end, 102);
  assert.equal(e.at(-1)!.value, 102);
  assert.equal(e[0].value, 100);
  for (let i = 1; i < e.length; i++) assert.ok(e[i].value >= e[i - 1].value);
  assert.ok(rows.every((r) => GRID(r.ts)));
  assert.equal(rows.filter((r) => r.metric === "power_w").length, fr.length);
});

test("buildDay: formato real (150 quadros, zeros nas pontas), soma = diário", () => {
  const fr = framesOf("2026-10-08", "05:45", "18:10", (i, n) => Math.max(0, Math.round(3500 * Math.sin((Math.PI * i) / (n - 1)))));
  fr[0].generationPower = 0; fr.at(-1)!.generationPower = 0;
  const e = energy(buildDay({ day: "2026-10-08", frames: fr, dailyKwh: 19.8, base: 20000 }).rows);
  assert.ok(Math.abs(e.at(-1)!.value - e[0].value - 19.8) < 0.001);
});

test("buildDay: sem quadros ou potência toda zero -> 1 leitura às 23:55 locais", () => {
  for (const fr of [[], framesOf("2022-11-15", "06:00", "07:00", () => 0)]) {
    const e = energy(buildDay({ day: "2022-11-15", frames: fr, dailyKwh: 12.3, base: 50 }).rows);
    assert.deepEqual(e.map((r) => [r.ts, r.value]), [["2022-11-16T02:55:00.000Z", 62.3]]);
  }
});

test("buildDay: diário 0 mantém o total em base", () => {
  const e = energy(buildDay({ day: "2026-10-08", frames: framesOf("2026-10-08", "10:00", "11:00", () => 50), dailyKwh: 0, base: 7 }).rows);
  assert.ok(e.every((r) => r.value === 7));
});

test("buildDay: before corta as leituras do dia S; mesmo bin fica o último; quadro de outro dia é ignorado", () => {
  const fr = framesOf("2026-10-08", "10:00", "12:00", () => 1000);
  const before = localTime("2026-10-08", "11:00");
  const { rows } = buildDay({ day: "2026-10-08", frames: fr, dailyKwh: 2, base: 0, before });
  assert.ok(rows.every((r) => r.ts < before));
  const dup = buildDay({ day: "2026-10-08", dailyKwh: 1, base: 0, frames: [
    { dateTime: ep(localTime("2026-10-08", "10:00")), generationPower: 10 },
    { dateTime: ep(localTime("2026-10-08", "10:00")) + 60, generationPower: 20 },
    { dateTime: ep(localTime("2026-10-09", "10:00")), generationPower: 99 },
  ] }).rows.filter((r) => r.metric === "power_w");
  assert.deepEqual(dup.map((r) => r.value), [20]);
});

// ---- backfillStep ----

/** Planta falsa: diário de 10 kWh por dia, quadros só a partir de 2026-09-01, início em 2026-08-20. */
function plant() {
  const calls: string[] = [];
  const sm: Solarman = {
    async stations() { calls.push("stations"); return [{ id: 7, name: "P", startOperatingTime: ep(localTime("2026-08-20", "08:00")) }]; },
    async realTime() { throw new Error("não usado"); },
    async frames(_id, day) { calls.push("frames:" + day); return day >= "2026-09-01" ? framesOf(day, "07:00", "17:00", () => 1000) : []; },
    async daily(_id, from, to) {
      calls.push(`daily:${from}..${to}`);
      const out: DailyItem[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) { const [y, m, dd] = d.split("-").map(Number); out.push({ year: y, month: m, day: dd, generationValue: 10 }); }
      return out;
    },
  };
  return { sm, calls };
}

const T0 = localTime("2026-10-08", "07:00"); // primeira leitura ao vivo (dia S)
async function liveDb() {
  const m = memDb({ settings: { solarman_backfill_enabled: "true" }, externalId: "7" });
  await m.db.insertReadings([{ device_id: "solar_plant", metric: "energy_total_kwh", ts: T0, value: 1000 }]);
  return m;
}

test("backfillStep: desligado, já feito ou sem leitura ao vivo -> não chama a API", async () => {
  for (const settings of [{}, { solarman_backfill_enabled: "true", solarman_backfill_done: "true" }, { solarman_backfill_enabled: "true" }]) {
    const { sm, calls } = plant();
    const r = await backfillStep({ sm, db: memDb({ settings, externalId: "7" }).db, clock: fixedClock("2026-10-10T12:00:00Z"), daysPerRun: 10 });
    assert.equal(r.written, 0);
    assert.deepEqual(calls, []);
  }
});

test("backfillStep: o dia S ainda é hoje -> espera", async () => {
  const m = await liveDb();
  const { sm, calls } = plant();
  const r = await backfillStep({ sm, db: m.db, clock: fixedClock("2026-10-08T20:00:00Z"), daysPerRun: 10 });
  assert.equal(r.written, 0);
  assert.deepEqual(calls, []);
});

test("backfillStep: âncora, encadeamento entre rodadas e parada no início da operação", async () => {
  const m = await liveDb();
  const { sm, calls } = plant();
  const clock = fixedClock("2026-10-09T12:00:00Z");

  const r1 = await backfillStep({ sm, db: m.db, clock, daysPerRun: 10 });
  assert.equal(r1.done, false);
  assert.deepEqual(calls.filter((c) => c.startsWith("daily")), ["daily:2026-09-29..2026-10-08"]);
  assert.equal(calls.filter((c) => c.startsWith("frames")).length, 10);
  assert.equal(m.settings.get("solarman_backfill_cursor"), "2026-09-28");
  // dia S: às 07:00 a geração ainda é 0 -> B(S) = 1000; dias anteriores descem 10 por dia
  assert.equal(m.settings.get("solarman_backfill_base"), String(1000 - 9 * 10));
  const e = m.series("solar_plant", "energy_total_kwh");
  assert.ok(e.every((r) => r.ts <= T0));
  for (let i = 1; i < e.length; i++) assert.ok(e[i].value >= e[i - 1].value, "hodômetro contínuo");
  assert.equal(e.at(-1)!.value, 1000); // a leitura ao vivo continua a última

  let r = r1;
  for (let i = 0; i < 10 && !r.done; i++) r = await backfillStep({ sm, db: m.db, clock, daysPerRun: 10 });
  assert.equal(r.done, true);
  assert.equal(m.settings.get("solarman_backfill_done"), "true");
  assert.equal(m.settings.get("solarman_backfill_start"), "2026-08-20");
  assert.equal(calls.filter((c) => c === "stations").length, 1);
  assert.ok(!calls.some((c) => c === "frames:2026-08-19"));

  const all = m.series("solar_plant", "energy_total_kwh");
  for (let i = 1; i < all.length; i++) assert.ok(all[i].value >= all[i - 1].value, "contínuo em todo o histórico");
  // 49 dias completos antes de S (20/08 a 07/10) a 10 kWh; a 1ª leitura é a véspera (19/08 23:55)
  assert.equal(all[0].ts, "2026-08-20T02:55:00.000Z");
  assert.ok(Math.abs(1000 - all[0].value - 49 * 10) < 0.01);

  const again = await backfillStep({ sm, db: m.db, clock, daysPerRun: 10 });
  assert.deepEqual([again.written, again.done], [0, true]);
});

test("backfillStep: primeira leitura ao vivo ao meio-dia desconta a manhã de S", async () => {
  const t0 = localTime("2026-10-08", "12:00");
  const m = memDb({ settings: { solarman_backfill_enabled: "true" }, externalId: "7" });
  await m.db.insertReadings([{ device_id: "solar_plant", metric: "energy_total_kwh", ts: t0, value: 1000 }]);
  const { sm } = plant();
  await backfillStep({ sm, db: m.db, clock: fixedClock("2026-10-09T12:00:00Z"), daysPerRun: 2 });
  const e = m.series("solar_plant", "energy_total_kwh");
  // 1000 W das 07:00 às 17:00 = 10 kWh; às 12:00 já foram 5 -> B(S) = 995; fim de 07/10 = 995
  assert.equal(e.find((r) => r.ts === localTime("2026-10-08", "07:00"))!.value, 995);
  assert.ok(e.filter((r) => r.ts < t0).every((r) => r.value < 1000));
  assert.equal(m.settings.get("solarman_backfill_base"), "985");
});

test("backfillStep: erro da API no meio não avança o cursor além do último dia gravado", async () => {
  const m = await liveDb();
  const { sm } = plant();
  const frames = sm.frames;
  sm.frames = async (id, day) => { if (day === "2026-10-05") throw new Error("/station/v1.0/history: rede: timeout"); return frames(id, day); };
  await assert.rejects(backfillStep({ sm, db: m.db, clock: fixedClock("2026-10-09T12:00:00Z"), daysPerRun: 10 }), /timeout/);
  assert.equal(m.settings.get("solarman_backfill_cursor"), "2026-10-05");
  // gravados S (B = 1000), 07/10 (990) e 06/10 (980); o cursor para no 05/10, que falhou
  assert.equal(m.settings.get("solarman_backfill_base"), String(1000 - 2 * 10));
});
