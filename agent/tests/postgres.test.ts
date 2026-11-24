// Fonte postgres contra um banco de laboratório (migrations + seed_demo). Roda quando AGENT_PG_URL existe
// (no CI, o job do assistente sobe o Postgres e aplica o seed; localmente, ver agent/README.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { postgresProvider } from "../src/data/postgres.ts";
import { compararPeriodo } from "../src/tools/dias.ts";
import { statusColeta } from "../src/tools/coleta.ts";
import { addDays } from "../../app/util.js";
import { systemClock } from "../src/clock.ts";

const url = process.env.AGENT_PG_URL;

test("postgres: lê v_house_daily do seed com a curva conhecida", { skip: !url && "sem AGENT_PG_URL" }, async () => {
  const db = postgresProvider(url!);
  try {
    const ontem = addDays(systemClock().today(), -1);
    const [d] = await db.days(ontem, ontem);
    assert.equal(d.day, ontem);
    // seed_demo: boiler 1500 W das 6h às 8h = 3 kWh; ar 900 W das 11h às 15h = 3,6 kWh; base 350 W o dia todo = 8,4 kWh.
    assert.ok(Math.abs(d.bo! - 3) < 0.01, `boiler ${d.bo}`);
    assert.ok(Math.abs(d.ac! - 3.6) < 0.01, `ar ${d.ac}`);
    assert.ok(Math.abs(d.consumo! - 15) < 0.2, `consumo ${d.consumo}`);
    assert.ok(d.g! > 10 && d.g! < 14, `geração ${d.g}`);
    const cmp = await compararPeriodo(db, ontem, 7);
    assert.equal(cmp.dias_comparados, 7);
    assert.ok(Math.abs(cmp.diferenca_consumo_kwh!) < 0.2);
    assert.deepEqual(await db.bills(), []);
    assert.equal((await statusColeta(db)).aviso, "nenhuma rodada do coletor registrada");
  } finally {
    await db.close!();
  }
});
