import test from "node:test";
import assert from "node:assert/strict";
import { creditMonths, balanceChecks } from "../credits-months.js";
import { creditsHtml } from "../credits-html.js";

// Numeros das contas de mai a set/2026 (sem nome, codigo de cliente ou instalacao).
const bill = (ref_month, kwh_measured, kwh_injected, credit_balance_kwh = null) => ({ ref_month, kwh_measured, kwh_injected, kwh_billed: 100, credit_balance_kwh });
const BILLS = [
  bill("2026-05-01", 406, 251),
  bill("2026-06-01", 435, 139.67),
  bill("2026-07-01", 505, 175),
  bill("2026-08-01", 310, 212, 1938.67),
  bill("2026-09-01", 312, 312, 2038.67)
];

test("separa o crédito do próprio mês do crédito antigo, descontando o mínimo de 100 kWh", () => {
  const [may, , jul, aug, sep] = creditMonths(BILLS);
  assert.deepEqual([may.ref, may.compensated, may.own, may.old, may.net], ["2026-05", 306, 251, 55, -55]);
  assert.deepEqual([jul.own, jul.old, jul.net], [175, 230, -230]);
  assert.deepEqual([aug.own, aug.old, aug.net], [210, 0, 2]);
  assert.deepEqual([sep.compensated, sep.own, sep.old, sep.net], [212, 212, 0, 100]);
});

test("ordena por mês mesmo que as contas venham fora de ordem e ignora linhas sem mês", () => {
  const rows = creditMonths([BILLS[4], { ...BILLS[0] }, { kwh_measured: 1 }, BILLS[2]]);
  assert.deepEqual(rows.map(r => r.ref), ["2026-05", "2026-07", "2026-09"]);
});

test("sem medição nem medidor, o mês fica sem compensação em vez de chutar", () => {
  const [r] = creditMonths([{ ref_month: "2026-04-01", kwh_injected: 23 }]);
  assert.equal(r.compensated, null);
  assert.equal(r.net, null);
  assert.equal(r.injected, 23);
});

test("usa leituras do medidor quando kwh_measured não veio preenchido", () => {
  const [r] = creditMonths([{ ref_month: "2026-09-01", meter_reading_prev: 14482, meter_reading_curr: 14794, meter_constant: 1, kwh_injected: 312 }]);
  assert.equal(r.consumed, 312);
  assert.equal(r.compensated, 212);
});

test("conferência: saldo de set = saldo de ago + injetado − compensado", () => {
  const checks = balanceChecks(creditMonths(BILLS));
  assert.deepEqual(checks.at(-1), { ref: "2026-09", diff: 0, status: "ok" });
  assert.equal(checks.filter(c => c.status === "sem_dados").length, 3);
});

test("conferência acusa diferença e não compara meses não seguidos", () => {
  const rows = creditMonths([bill("2026-08-01", 310, 212, 1938.67), bill("2026-09-01", 312, 312, 2100)]);
  assert.equal(balanceChecks(rows)[0].status, "diferente");
  const gap = creditMonths([bill("2026-07-01", 505, 175, 1900), bill("2026-09-01", 312, 312, 2038.67)]);
  assert.equal(balanceChecks(gap)[0].status, "sem_dados");
});

test("bloco da tela mostra saldo, conferência e totais; vazio sem contas", () => {
  const rows = creditMonths(BILLS);
  const html = creditsHtml(rows, balanceChecks(rows));
  assert.match(html, /2\.038,67/);
  assert.match(html, /Conferência ok/);
  assert.match(html, /1\.089,67|1\.090/);
  assert.equal(creditsHtml([], []), "");
});
