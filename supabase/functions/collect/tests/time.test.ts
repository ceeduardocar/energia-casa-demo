import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, bin5, localDay, localEndSlot, localTime } from "../time.ts";

test("bin5 arredonda para baixo ao passo de 5 min", () => {
  assert.equal(bin5(1791538339), "2026-10-09T09:30:00.000Z");
  assert.equal(bin5(1791538200), "2026-10-09T09:30:00.000Z");
});

test("localDay usa o fuso de Brasília nas viradas do dia", () => {
  assert.equal(localDay(Date.parse("2026-10-09T03:00:00Z") / 1000), "2026-10-09"); // 00:00 local
  assert.equal(localDay(Date.parse("2026-10-09T02:59:00Z") / 1000), "2026-10-08"); // 23:59 local
});

test("localEndSlot e localTime", () => {
  assert.equal(localEndSlot("2022-11-15"), "2022-11-16T02:55:00.000Z");
  assert.equal(localTime("2026-10-09", "07:00"), "2026-10-09T10:00:00.000Z");
  // horário de verão antigo (2018-11-04 a 2019-02-16 era UTC-2)
  assert.equal(localTime("2019-01-10", "12:00"), "2019-01-10T14:00:00.000Z");
});

test("addDays atravessa meses", () => {
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
});
