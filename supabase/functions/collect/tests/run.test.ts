import { test } from "node:test";
import assert from "node:assert/strict";
import { runAll } from "../run.ts";
import { memDb } from "./fakes.ts";

const T = { liveTimeoutMs: 50, backfillTimeoutMs: 50 };
const ok = (written: number, notes: string[] = []) => async () => ({ written, notes });
const fail = (msg: string) => async () => { throw new Error(msg); };

test("sucesso: soma ao vivo + backfill e junta as notas", async () => {
  const m = memDb();
  await runAll({ ...T, db: m.db, sources: [{ name: "solarman", live: ok(2, ["a"]), backfill: ok(300, ["b"]) }] });
  assert.deepEqual(m.runs, [{ source: "solarman", ok: true, readings_written: 302, error_message: "a; backfill: b" }]);
});

test("sem notas: error_message nulo", async () => {
  const m = memDb();
  await runAll({ ...T, db: m.db, sources: [{ name: "solarman", live: ok(0) }] });
  assert.equal(m.runs[0].error_message, null);
});

test("ao vivo falha: ok = false e o backfill não roda", async () => {
  const m = memDb();
  let ran = false;
  await runAll({ ...T, db: m.db, sources: [{ name: "solarman", live: fail("x"), backfill: async () => { ran = true; return { written: 1, notes: [] }; } }] });
  assert.deepEqual(m.runs[0], { source: "solarman", ok: false, readings_written: 0, error_message: "x" });
  assert.equal(ran, false);
});

test("backfill falha: ok continua true", async () => {
  const m = memDb();
  await runAll({ ...T, db: m.db, sources: [{ name: "solarman", live: ok(2), backfill: fail("timeout") }] });
  assert.deepEqual(m.runs[0], { source: "solarman", ok: true, readings_written: 2, error_message: "backfill: timeout" });
});

test("tempo esgotado numa fonte: a seguinte roda", async () => {
  const m = memDb();
  const slow = () => new Promise<{ written: number; notes: string[] }>((r) => setTimeout(() => r({ written: 1, notes: [] }), 500));
  await runAll({ ...T, db: m.db, sources: [{ name: "solarman", live: slow }, { name: "tuya", live: ok(3) }] });
  assert.equal(m.runs[0].ok, false);
  assert.equal(m.runs[0].error_message, "tempo esgotado (0.05 s)");
  assert.deepEqual(m.runs[1], { source: "tuya", ok: true, readings_written: 3, error_message: null });
});

test("error_message cortada em 500 caracteres", async () => {
  const m = memDb();
  await runAll({ ...T, db: m.db, sources: [{ name: "solarman", live: fail("x".repeat(900)) }] });
  assert.equal(m.runs[0].error_message!.length, 500);
});

test("só backfill: não chama o ao vivo e registra o que gravou", async () => {
  const m = memDb();
  let live = false;
  await runAll({ ...T, mode: "backfill", db: m.db, sources: [{ name: "solarman", live: async () => { live = true; return { written: 1, notes: [] }; }, backfill: ok(300) }] });
  assert.equal(live, false);
  assert.deepEqual(m.runs, [{ source: "solarman", ok: true, readings_written: 300, error_message: null }]);
});

test("só backfill sem trabalho: nenhuma linha em collector_runs", async () => {
  const m = memDb();
  await runAll({ ...T, mode: "backfill", db: m.db, sources: [{ name: "solarman", live: ok(1), backfill: ok(0) }] });
  assert.deepEqual(m.runs, []);
});

test("só backfill com falha: registra ok = false", async () => {
  const m = memDb();
  await runAll({ ...T, mode: "backfill", db: m.db, sources: [{ name: "solarman", live: ok(1), backfill: fail("rede") }] });
  assert.deepEqual(m.runs, [{ source: "solarman", ok: false, readings_written: 0, error_message: "backfill: rede" }]);
});

test("só backfill: fonte sem backfill é ignorada", async () => {
  const m = memDb();
  await runAll({ ...T, mode: "backfill", db: m.db, sources: [{ name: "tuya", live: ok(3) }] });
  assert.deepEqual(m.runs, []);
});

test("fonte não devida (live devolve null): sem registro em collector_runs e sem backfill", async () => {
  const m = memDb();
  let ran = false;
  await runAll({ ...T, db: m.db, sources: [{ name: "solarman", live: async () => null, backfill: async () => { ran = true; return { written: 1, notes: [] }; } }] });
  assert.deepEqual(m.runs, []);
  assert.equal(ran, false);
});

test("uma fonte falha e a outra segue: a falha fica registrada só na sua fonte", async () => {
  const m = memDb();
  await runAll({ ...T, db: m.db, sources: [
    { name: "tuya", live: fail("assinatura de teste vencida") },
    { name: "solarman", live: ok(3) },
  ] });
  assert.deepEqual(m.runs, [
    { source: "tuya", ok: false, readings_written: 0, error_message: "assinatura de teste vencida" },
    { source: "solarman", ok: true, readings_written: 3, error_message: null },
  ]);
});
