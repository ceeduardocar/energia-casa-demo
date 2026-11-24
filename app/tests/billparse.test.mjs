// Leitura da conta da Neoenergia a partir do texto do PDF.
// Fixtures: texto de 5 contas reais (05 a 09/2026) sem dados pessoais e com a
// chave de acesso trocada por dígitos fictícios.
// Rodar: node --test app/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseBillLines, brNum } from "../billparse.js";
import { checks } from "../bills.js";

const load = (m) => JSON.parse(readFileSync(new URL(`./fixtures/conta-${m}-2026.json`, import.meta.url), "utf8"));

const EXPECTED = {
  "05": { ref_month: "2026-05", issue_date: "2026-05-28", due_date: "2026-06-23",
          reading_prev_date: "2026-04-08", reading_curr_date: "2026-05-09", next_reading_date: "2026-06-08", days: 31,
          meter_reading_prev: 12826, meter_reading_curr: 13232, kwh_measured: 406, kwh_billed: 100, kwh_reactive: 12999,
          kwh_adjust_cat: -306, kwh_injected: 251, credit_balance_kwh: 2362,
          tusd_brl: 50.15, te_brl: 47.65, flag_brl: 0.63, public_lighting_brl: 40.14, other_brl: 0, total_brl: 138.57 },
  "06": { ref_month: "2026-06", issue_date: "2026-06-24", due_date: "2026-07-23",
          reading_prev_date: "2026-05-09", reading_curr_date: "2026-06-08", next_reading_date: "2026-07-08", days: 30,
          meter_reading_prev: 13232, meter_reading_curr: 13667, kwh_measured: 435, kwh_billed: 100, kwh_reactive: 668,
          kwh_adjust_cat: -335, kwh_injected: 139.67, credit_balance_kwh: 2166.67,
          tusd_brl: 49.51, te_brl: 47.04, flag_brl: 2.19, public_lighting_brl: 40.14, other_brl: 0, total_brl: 138.88 },
  "07": { ref_month: "2026-07", issue_date: "2026-07-31", due_date: "2026-08-24",
          reading_prev_date: "2026-06-08", reading_curr_date: "2026-07-08", next_reading_date: "2026-08-07", days: 30,
          meter_reading_prev: 13667, meter_reading_curr: 14172, kwh_measured: 505, kwh_billed: 100, kwh_reactive: 505,
          kwh_adjust_cat: -405, kwh_injected: 175, credit_balance_kwh: 1936.67,
          tusd_brl: 50.34, te_brl: 47.83, flag_brl: 2.23, public_lighting_brl: 50.68, other_brl: 0, total_brl: 151.08 },
  "08": { ref_month: "2026-08", issue_date: "2026-08-18", due_date: "2026-09-23",
          reading_prev_date: "2026-07-08", reading_curr_date: "2026-08-07", next_reading_date: "2026-09-09", days: 30,
          meter_reading_prev: 14172, meter_reading_curr: 14482, kwh_measured: 310, kwh_billed: 100, kwh_reactive: 310,
          kwh_adjust_cat: -210, kwh_injected: 212, credit_balance_kwh: 1938.67,
          tusd_brl: 50.58, te_brl: 48.06, flag_brl: 2.24, public_lighting_brl: 32.14, other_brl: -8.96, total_brl: 124.06 },
  // conta do exemplo da spec, ainda não paga: com juros e multa da conta anterior
  "09": { ref_month: "2026-09", issue_date: "2026-10-06", due_date: "2026-10-23",
          reading_prev_date: "2026-08-07", reading_curr_date: "2026-09-09", next_reading_date: "2026-10-07", days: 33,
          meter_reading_prev: 14482, meter_reading_curr: 14794, kwh_measured: 312, kwh_billed: 100, kwh_reactive: 312,
          kwh_adjust_cat: -212, kwh_injected: 312, credit_balance_kwh: 2038.67,
          tusd_brl: 50.5, te_brl: 47.98, flag_brl: 2.23, interest_brl: 0.56, fine_brl: 1.99,
          public_lighting_brl: 32.14, other_brl: 0, total_brl: 135.4 }
};

for (const [m, exp] of Object.entries(EXPECTED)) {
  test(`conta ${m}/2026: campos lidos`, () => {
    const b = parseBillLines(load(m));
    assert.ok(b, "conta reconhecida");
    for (const [k, v] of Object.entries(exp)) assert.equal(b[k], v, k);
    assert.equal(b.meter_number, "1234567");
    assert.equal(b.meter_constant, 1);
    assert.equal(b.class, "B1 RESIDENCIAL");
    assert.equal(b.supply_type, "Trifásico");
    assert.equal(b.flag_name, "amarela");
    assert.equal(b.extraction_method, "pdf_text");
    assert.match(b.access_key, /^\d{44}$/);
  });

  test(`conta ${m}/2026: historico de 13 meses em ordem`, () => {
    const h = parseBillLines(load(m)).consumption_history;
    assert.equal(h.length, 13);
    assert.equal(h.at(-1).ref_month, exp.ref_month);
    assert.deepEqual(h.map(x => x.ref_month), [...h.map(x => x.ref_month)].sort());
    assert.ok(h.every(x => x.kwh === 100 && x.days >= 28 && x.days <= 33));
  });

  test(`conta ${m}/2026: todas as verificacoes da conferencia passam`, () => {
    const failed = checks(parseBillLines(load(m)), []).filter(c => !c.ok).map(c => c.id);
    assert.deepEqual(failed, []);
  });
}

test("saldo encadeia de uma conta para a seguinte (anterior + injetado + CAT)", () => {
  const bs = ["05", "06", "07", "08", "09"].map(m => parseBillLines(load(m)));
  for (let i = 1; i < bs.length; i++) {
    const exp = bs[i - 1].credit_balance_kwh + bs[i].kwh_injected + bs[i].kwh_adjust_cat;
    assert.ok(Math.abs(exp - bs[i].credit_balance_kwh) < 0.005, `${bs[i].ref_month}: ${exp} x ${bs[i].credit_balance_kwh}`);
  }
});

test("texto que nao e conta devolve nulo", () => {
  assert.equal(parseBillLines([["Qualquer documento"], ["01/01/2026"]]), null);
});

test("numeros no formato brasileiro", () => {
  assert.equal(brNum("14.172,00"), 14172);
  assert.equal(brNum("8,96-"), -8.96);
  assert.equal(brNum("- 210"), -210);
  assert.equal(brNum("0,50585663"), 0.50585663);
  assert.equal(brNum("2362"), 2362);
  assert.equal(brNum("abc"), null);
});
