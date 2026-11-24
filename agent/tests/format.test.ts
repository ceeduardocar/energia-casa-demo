import { test } from "node:test";
import assert from "node:assert/strict";
import { r2, f1, f2, kwhText, brlText } from "../src/format.ts";

test("r2 arredonda a 2 casas e devolve null para o que não é número finito", () => {
  assert.equal(r2(19.488), 19.49);
  assert.equal(r2(-0.005), -0);
  assert.equal(r2(null), null);
  assert.equal(r2(undefined), null);
  assert.equal(r2(NaN), null);
  assert.equal(r2("3" as unknown), null);
});

test("f1 e f2 escrevem em português, com 'sem dado' quando falta", () => {
  assert.equal(f1(19.488), "19,5");
  assert.equal(f1(null), "sem dado");
  assert.equal(f2(2038.67), "2.038,67");
  assert.equal(f2(100), "100");
  assert.equal(f2(undefined), "sem dado");
});

test("kwhText e brlText para os textos das contas", () => {
  assert.equal(kwhText(139.67), "139,67 kWh");
  assert.equal(kwhText(null), "não informado");
  assert.equal(brlText(50.5), "R$ 50,50");
  assert.equal(brlText(undefined), "não informado");
});
