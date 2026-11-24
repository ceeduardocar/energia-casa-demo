// Exportação para o Postgres do laboratório. Roda quando AGENT_PG_URL existe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { exportRecords, toRow } from "../src/obs/pg-export.ts";
import { parseRecords } from "../src/obs/report.ts";

const url = process.env.AGENT_PG_URL;
const AMOSTRA = new URL("../obs-amostra/2026-11-23-offline.jsonl", import.meta.url);

test("toRow achata o registro nas colunas de obs.perguntas", async () => {
  const [r] = parseRecords(await readFile(AMOSTRA, "utf8"));
  const row = toRow(r);
  assert.equal(row.length, 16);
  assert.equal(row[3], r.rota.expert);
  assert.equal(row[13], r.checagem.sem_fonte.length);
  assert.deepEqual(JSON.parse(row[15] as string).id, r.id);
});

test("postgres: exporta a amostra uma vez só (id é a chave)", { skip: !url && "sem AGENT_PG_URL" }, async () => {
  const rows = parseRecords(await readFile(AMOSTRA, "utf8"));
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("drop schema if exists obs cascade");
    assert.equal(await exportRecords(url!, rows), rows.length);
    assert.equal(await exportRecords(url!, rows), rows.length);
    const { rows: e } = await c.query("select expert, count(*)::int n from obs.perguntas group by 1 order by 1");
    assert.deepEqual(e, [{ expert: "consumo", n: 3 }, { expert: "creditos", n: 4 }, { expert: "operacao", n: 2 }]);
  } finally {
    await c.query("drop schema if exists obs cascade");
    await c.end();
  }
});
