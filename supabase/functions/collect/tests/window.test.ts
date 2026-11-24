import { test } from "node:test";
import assert from "node:assert/strict";
import { inSolarWindow } from "../time.ts";

// 12/10/2026 é horário de verão? Não: Brasília é UTC−3 o ano todo desde 2019.
const br = (hhmm: string) => Date.parse(`2026-10-12T${hhmm}:00-03:00`);

test("inSolarWindow: 06:25 fora, 06:30 dentro, 18:55 dentro, 18:56 fora", () => {
  assert.equal(inSolarWindow(br("06:25")), false);
  assert.equal(inSolarWindow(br("06:30")), true);
  assert.equal(inSolarWindow(br("07:00")), true);
  assert.equal(inSolarWindow(br("18:55")), true);
  assert.equal(inSolarWindow(br("18:56")), false);
});

test("inSolarWindow: madrugada e meio-dia", () => {
  assert.equal(inSolarWindow(br("01:00")), false);
  assert.equal(inSolarWindow(br("12:00")), true);
});
