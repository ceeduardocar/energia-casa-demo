import { test } from "node:test";
import assert from "node:assert/strict";
import { hasNumber, score } from "../eval/run.ts";

test("hasNumber aceita o número arredondado pela resposta", () => {
  assert.equal(hasNumber("consumiu 19,5 kWh", 19.49), true);
  assert.equal(hasNumber("consumiu 19,49 kWh", 19.49), true);
  assert.equal(hasNumber("saldo de 2.038,67 kWh", 2038.67), true);
  assert.equal(hasNumber("consumiu 18 kWh", 19.49), false);
});

test("score marca cada critério separadamente", () => {
  const item = { id: "x", pergunta: "?", expert: ["consumo"], ferramentas: ["resumo_dia"], numeros: [10], palavras: ["boiler"], documento: "a.md" };
  const r: any = {
    rota: { expert: "consumo" }, passos: [{ ferramenta: "resumo_dia" }], resposta: "Boiler gastou 10 kWh.",
    recuperados: [], checagem: { ok: true }, erro: undefined,
  };
  const s = score(item, r);
  assert.equal(s.documento, false);
  assert.equal(s.ok, false);
  assert.equal(score({ ...item, documento: undefined }, r).ok, true);
});
