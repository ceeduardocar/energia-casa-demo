import { test } from "node:test";
import assert from "node:assert/strict";
import { demo } from "../../app/demo.js";
import { demoProvider } from "../src/data/demo.ts";
import { compararPeriodo, diasTools, resumoDoDia } from "../src/tools/dias.ts";
import { creditosResumo } from "../src/tools/creditos.ts";
import { diagnostico, statusColeta } from "../src/tools/coleta.ts";
import { fixedProvider, row } from "./helpers.ts";

test("resumo_dia devolve os números de v_house_daily do app demo, arredondados", async () => {
  const [ref] = await demo.fetchDaily("2026-11-19", "2026-11-19");
  const [resumo] = diasTools(demoProvider());
  const out = JSON.parse(await resumo.invoke({ dia: "2026-11-19" }));
  assert.equal(out.consumo_kwh, Math.round(ref.consumo * 100) / 100);
  assert.equal(out.geracao_kwh, Math.round(ref.g * 100) / 100);
  assert.equal(out.autossuficiencia_pct, Math.round(ref.autossuficiencia * 100));
  assert.equal(out.dia_semana, "Qui");
  assert.equal(out.fonte, "v_house_daily");
});

test("resumo_dia sem dados devolve erro, não exceção", async () => {
  const [resumo] = diasTools(fixedProvider([]));
  assert.deepEqual(JSON.parse(await resumo.invoke({ dia: "2026-01-01" })), { erro: "sem dados para 2026-01-01", fonte: "v_house_daily" });
});

test("resumo_dia rejeita data fora do formato", async () => {
  const [resumo] = diasTools(fixedProvider([]));
  await assert.rejects(() => resumo.invoke({ dia: "ontem" }));
});

test("comparar_periodo: média dos dias anteriores e a parcela que mais explica", async () => {
  const rows = [
    row("2026-11-10", { bo: 2, ac: 3 }), row("2026-11-11", { bo: 2, ac: 5 }), row("2026-11-12", { bo: 2, ac: 4 }),
    row("2026-11-13", { i: 14, bo: 8, ac: 4 }), // 6 kWh a mais de boiler
  ];
  const out = await compararPeriodo(fixedProvider(rows), "2026-11-13", 3);
  assert.equal(out.dias_comparados, 3);
  assert.equal(out.consumo_dia_kwh, 20);
  assert.equal(out.consumo_medio_kwh, 14);
  assert.equal(out.diferenca_consumo_kwh, 6);
  assert.equal(out.diferenca_consumo_pct, 43);
  assert.equal(out.maior_diferenca, "boiler");
  assert.deepEqual(out.por_parcela[1], { parcela: "boiler", dia_kwh: 8, media_kwh: 2, diferenca_kwh: 6 });
});

test("comparar_periodo sem dias anteriores devolve erro", async () => {
  const out = await compararPeriodo(fixedProvider([row("2026-11-13")]), "2026-11-13", 7);
  assert.match(out.erro!, /sem dias anteriores/);
});

test("creditos reaproveita app/credits-months.js: setembro compensa 212 kWh e sobra 100", async () => {
  const out = await creditosResumo(demoProvider());
  const set = out.meses.find(m => m.mes === "2026-09")!;
  assert.equal(set.consumido_kwh, 312);
  assert.equal(set.injetado_kwh, 312);
  assert.equal(set.compensado_kwh, 212);
  assert.equal(set.saldo_do_mes_kwh, 100);
  assert.equal(set.saldo_na_conta_kwh, 2038.67);
  assert.deepEqual(out.conferencia_entre_meses.find(c => c.ref === "2026-09"), { ref: "2026-09", diff: 0, status: "ok" });
  assert.equal(out.minimo_faturado_kwh, 100);
});

test("creditos sem contas e sem saldo: listas vazias e agora nulo", async () => {
  const out = await creditosResumo(fixedProvider([]));
  assert.deepEqual(out.meses, []);
  assert.equal(out.agora, null);
});

test("status_coleta: em dia, atrasada, falhando e pausa noturna da Solarman", () => {
  const dia = "2026-11-20T15:00:00Z";   // 12:00 em Brasília
  const noite = "2026-11-21T01:00:00Z"; // 22:00 em Brasília
  const s = (source: string, ok: boolean, age: number) => ({ source, ok, started_at: dia, age_minutes: age });
  assert.equal(diagnostico(s("tuya", true, 4), dia), "em dia");
  assert.equal(diagnostico(s("tuya", true, 40), dia), "atrasada");
  assert.equal(diagnostico(s("tuya", false, 4), dia), "falhando");
  assert.equal(diagnostico(s("solarman", true, 180), noite), "pausa noturna");
  assert.equal(diagnostico(s("tuya", true, 180), noite), "atrasada");
  assert.equal(diagnostico(s("solarman", true, 180), dia), "atrasada");
});

test("status_coleta sem rodadas avisa", async () => {
  const out = await statusColeta(fixedProvider([]));
  assert.equal(out.aviso, "nenhuma rodada do coletor registrada");
});

test("resumoDoDia aceita autossuficiência nula", () => {
  assert.equal(resumoDoDia(row("2026-11-01", { autossuficiencia: null })).autossuficiencia_pct, null);
});
