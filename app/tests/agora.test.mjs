import test from "node:test";
import assert from "node:assert/strict";
import { agoraFlow, ageText, sunUp } from "../util.js";

const base = { g: 2000, gAge: 3, grid: 500, gridAge: 2, exporting: true };

test("consumo = geração - injeção quando as leituras fecham", () => {
  const r = agoraFlow(base);
  assert.equal(r.consumo, 1500); assert.equal(r.reason, null);
});
test("importando soma a rede à geração", () => {
  assert.equal(agoraFlow({ ...base, exporting: false, grid: 700 }).consumo, 2700);
});
test("o caso do print: geração 1,75 kW e injeção 2,76 kW não fecham e o consumo fica nulo (não 0 W)", () => {
  const r = agoraFlow({ g: 1750, gAge: 8, grid: 2760, gridAge: 3, exporting: true });
  assert.equal(r.consumo, null); assert.equal(r.reason, "nao-fecham");
});
test("ruído pequeno negativo vira zero, não motivo", () => {
  const r = agoraFlow({ ...base, g: 1000, grid: 1100 });
  assert.equal(r.consumo, 0); assert.equal(r.reason, null);
});
test("geração velha: aguarda a Solarman", () => {
  const r = agoraFlow({ ...base, gAge: 20 });
  assert.equal(r.consumo, null); assert.equal(r.reason, "aguardando-solar");
});
test("rede velha: aguarda a rede", () => {
  const r = agoraFlow({ ...base, gridAge: 30 });
  assert.equal(r.reason, "aguardando-rede");
});
test("pausa noturna: geração vale 0 e a idade da Solarman não conta", () => {
  const r = agoraFlow({ g: 900, gAge: 600, solarPaused: true, grid: 300, gridAge: 2, exporting: false });
  assert.equal(r.g, 0); assert.equal(r.consumo, 300); assert.equal(r.gAge, null);
});
test("sem dado de rede ou de geração", () => {
  assert.equal(agoraFlow({ ...base, grid: undefined }).reason, "sem-dado");
  assert.equal(agoraFlow({ ...base, g: null }).reason, "sem-dado");
});
test("ageText", () => {
  assert.equal(ageText(0.4), "agora"); assert.equal(ageText(7.4), "há 7 min"); assert.equal(ageText(125), "há 2 h"); assert.equal(ageText(null), "");
});
test("sunUp: dia das 6h às 18h", () => {
  assert.equal(sunUp(5), false); assert.equal(sunUp(6), true); assert.equal(sunUp(17), true); assert.equal(sunUp(18), false);
});
