import test from "node:test";
import assert from "node:assert/strict";
import { kwhPrecise, selfUse } from "../util.js";

test("kwhPrecise diferencia zero de consumo positivo muito pequeno", () => {
  assert.equal(kwhPrecise(0, 1), "0,0");
  assert.equal(kwhPrecise(0.01, 1), "< 0,1");
  assert.equal(kwhPrecise(0.1, 1), "0,1");
});

test("kwhPrecise adapta a precisão ao período", () => {
  assert.equal(kwhPrecise(0.001, 2), "< 0,01");
  assert.equal(kwhPrecise(1.234, 2), "1,23");
  assert.equal(kwhPrecise(12.34, 1), "12,3");
  assert.equal(kwhPrecise(12.6, 0), "13");
  assert.equal(kwhPrecise(null, 1), "—");
});

test("selfUse usa o injetado liquido quando a view o considera confiavel", () => {
  const row = { injected_kwh: 9.6, self_kwh: 5.5, self_pct: 0.364, net_ok: true };
  assert.deepEqual(selfUse(row, 15.1, 13.9), { injected: 9.6, self: 5.5, pct: 0.364, estimated: false });
});

test("selfUse marca estimado quando a view caiu no bruto", () => {
  const row = { injected_kwh: 8, self_kwh: 2, self_pct: 0.2, net_ok: false };
  assert.equal(selfUse(row, 10, 8).estimated, true);
});

test("selfUse sem a view calcula pelo injetado bruto e marca estimado", () => {
  const r = selfUse(undefined, 15, 12);
  assert.equal(r.injected, 12);
  assert.equal(r.self, 3);
  assert.equal(r.pct, 0.2);
  assert.equal(r.estimated, true);
});

test("selfUse nunca devolve autoconsumo negativo nem divide por zero", () => {
  assert.equal(selfUse(undefined, 5, 7).self, 0);
  assert.equal(selfUse(undefined, 0, 0).pct, null);
  assert.deepEqual(selfUse(undefined, null, null), { injected: null, self: null, pct: null, estimated: true });
});
