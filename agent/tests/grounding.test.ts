import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNumbers, numbersInText, parsePt } from "../src/grounding.ts";

test("parsePt entende milhar com ponto, decimal com vírgula e formato de máquina", () => {
  assert.deepEqual(parsePt("1.938,67"), { value: 1938.67, decimals: 2 });
  assert.deepEqual(parsePt("12,5"), { value: 12.5, decimals: 1 });
  assert.deepEqual(parsePt("2038.67"), { value: 2038.67, decimals: 2 });
});

test("datas e horas não entram como números a checar", () => {
  assert.deepEqual(numbersInText("Em 2026-11-19 às 18:30 (19/11) a casa usou 19,5 kWh"), ["19,5"]);
});

test("números arredondados das ferramentas passam; número inventado não", () => {
  const fontes = [{ resultado: { consumo_kwh: 19.49, autossuficiencia_pct: 64, saldo: 2038.67 } }];
  assert.deepEqual(checkNumbers("Consumiu 19,5 kWh, 64% de autossuficiência, saldo de 2.038,67 kWh.", fontes), { ok: true, verificados: 3, sem_fonte: [] });
  const r = checkNumbers("Consumiu 19,5 kWh e o ar gastou 7,2 kWh.", fontes);
  assert.deepEqual(r, { ok: false, verificados: 2, sem_fonte: ["7,2"] });
});

test("fração das ferramentas aceita como porcentagem", () => {
  assert.equal(checkNumbers("Autossuficiência de 62%.", [{ autossuficiencia: 0.62 }]).ok, true);
});

test("números da pergunta e dos argumentos contam como fonte", () => {
  assert.equal(checkNumbers("Nos últimos 7 dias, 100 kWh.", ["veio com 100 kWh?", { args: { dias_antes: 7 } }]).ok, true);
});

test("texto de fonte com milhar em português não é partido em dois números", () => {
  assert.equal(checkNumbers("O saldo é de 2.038,67 kWh.", ["saldo de 2.038,67 kWh"]).ok, true);
});

test("fração vira porcentagem só quando a resposta diz %", () => {
  assert.deepEqual(checkNumbers("Consumiu 1950 kWh.", [{ consumo_kwh: 19.5 }]).sem_fonte, ["1950"]);
  assert.equal(checkNumbers("Consumiu 19,5 kWh, 62 % de autossuficiência.", [{ consumo_kwh: 19.5, a: 0.62 }]).ok, true);
});
