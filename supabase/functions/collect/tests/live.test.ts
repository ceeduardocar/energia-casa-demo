import { test } from "node:test";
import assert from "node:assert/strict";
import { collectLive } from "../live.ts";
import { memDb } from "./fakes.ts";
import type { RealTime, Solarman, Station } from "../types.ts";

function fakeSm(rt: RealTime | (() => RealTime), stations: Station[] = [{ id: 1000001, name: "BSB" }]) {
  const calls: string[] = [];
  const sm: Solarman = {
    async stations() { calls.push("stations"); return stations; },
    async realTime(id) { calls.push("realTime:" + id); return typeof rt === "function" ? rt() : rt; },
    async frames() { throw new Error("não usado"); },
    async daily() { throw new Error("não usado"); },
  };
  return { sm, calls };
}

const RT = { generationPower: 152, generationTotal: 20588.3, lastUpdateTime: 1791538339 };

test("descobre a planta quando external_id é nulo e grava as 2 leituras", async () => {
  const m = memDb();
  const { sm, calls } = fakeSm(RT);
  const r = await collectLive({ sm, db: m.db, maxPowerW: 6000 });
  assert.deepEqual(calls, ["stations", "realTime:1000001"]);
  assert.equal(m.external.get("solar_plant"), "1000001");
  assert.equal(r.written, 2);
  assert.deepEqual(r.notes, []);
  assert.deepEqual(m.series("solar_plant", "power_w").map((x) => [x.ts, x.value]), [["2026-10-09T09:30:00.000Z", 152]]);
  assert.deepEqual(m.series("solar_plant", "energy_total_kwh").map((x) => x.value), [20588.3]);
});

test("external_id salvo: não chama stations", async () => {
  const m = memDb({ externalId: "99" });
  const { sm, calls } = fakeSm(RT);
  await collectLive({ sm, db: m.db, maxPowerW: 6000 });
  assert.deepEqual(calls, ["realTime:99"]);
});

test("0 ou 2 plantas: erro", async () => {
  for (const st of [[], [{ id: 1, name: "a" }, { id: 2, name: "b" }]]) {
    const { sm } = fakeSm(RT, st);
    await assert.rejects(collectLive({ sm, db: memDb().db, maxPowerW: 6000 }), new RegExp(`esperava 1 planta, achei ${st.length}`));
  }
});

test("mesma lastUpdateTime duas vezes: a segunda grava 0", async () => {
  const m = memDb({ externalId: "1" });
  const { sm } = fakeSm(RT);
  await collectLive({ sm, db: m.db, maxPowerW: 6000 });
  const r = await collectLive({ sm, db: m.db, maxPowerW: 6000 });
  assert.equal(r.written, 0);
});

test("sem lastUpdateTime ou total: erro e nada gravado", async () => {
  for (const [rt, campo] of [[{ ...RT, lastUpdateTime: null }, "lastUpdateTime"], [{ ...RT, generationTotal: undefined }, "generationTotal"]] as const) {
    const m = memDb({ externalId: "1" });
    await assert.rejects(collectLive({ sm: fakeSm(rt).sm, db: m.db, maxPowerW: 6000 }), new RegExp(`resposta sem ${campo}`));
    assert.equal(m.readings.size, 0);
  }
});

test("potência ausente: grava só o total e anota", async () => {
  const m = memDb({ externalId: "1" });
  const r = await collectLive({ sm: fakeSm({ ...RT, generationPower: null }).sm, db: m.db, maxPowerW: 6000 });
  assert.equal(r.written, 1);
  assert.deepEqual(r.notes, ["resposta sem generationPower"]);
});

test("potência fora da faixa: descarta e anota", async () => {
  for (const p of [-5, 7000]) {
    const m = memDb({ externalId: "1" });
    const r = await collectLive({ sm: fakeSm({ ...RT, generationPower: p }).sm, db: m.db, maxPowerW: 6000 });
    assert.equal(r.written, 1);
    assert.deepEqual(r.notes, [`potência fora da faixa: ${p} W`]);
    assert.equal(m.series("solar_plant", "power_w").length, 0);
  }
});

test("total diminuiu: grava e anota", async () => {
  const m = memDb({ externalId: "1" });
  await m.db.insertReadings([{ device_id: "solar_plant", metric: "energy_total_kwh", ts: "2026-10-09T09:00:00.000Z", value: 20588.3 }]);
  const r = await collectLive({ sm: fakeSm({ ...RT, generationTotal: 20500 }).sm, db: m.db, maxPowerW: 6000 });
  assert.equal(r.written, 2);
  assert.deepEqual(r.notes, ["total diminuiu: 20588.3 -> 20500"]);
});
