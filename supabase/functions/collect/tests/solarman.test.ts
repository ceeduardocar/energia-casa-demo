import { test } from "node:test";
import assert from "node:assert/strict";
import { createSolarman } from "../solarman.ts";
import { fakeFetch, fixedClock, memDb } from "./fakes.ts";

const env = { appId: "APPID123", appSecret: "SECRETXYZ", email: "a@b.c", passwordSha256: "ab".repeat(32) };
const NOW = "2026-10-09T12:00:00Z";
const login = { body: { access_token: "TOK1", expires_in: 5183999, success: true } };
const rt = { body: { generationPower: 152, generationTotal: 20588.3, lastUpdateTime: 1791538339, success: true } };

test("sem token salvo: faz login com appId só na URL e salva a validade", async () => {
  const f = fakeFetch([login, rt]);
  const m = memDb();
  const sm = createSolarman({ fetch: f, db: m.db, clock: fixedClock(NOW), env });
  const r = await sm.realTime("1000001");
  assert.equal(r.generationPower, 152);
  assert.match(f.calls[0].url, /\/account\/v1\.0\/token\?appId=APPID123&language=en$/);
  assert.deepEqual(f.calls[0].body, { appSecret: "SECRETXYZ", email: "a@b.c", password: env.passwordSha256 });
  assert.equal(f.calls[1].headers.Authorization, "bearer TOK1");
  assert.deepEqual(f.calls[1].body, { stationId: 1000001 });
  assert.equal(m.tokens.get("solarman")?.expires_at, new Date(Date.parse(NOW) + 5183999000).toISOString());
});

test("token salvo com mais de 1 dia: não faz login", async () => {
  const f = fakeFetch([rt]);
  const m = memDb();
  await m.db.saveToken("solarman", "OLD", "2026-10-20T00:00:00Z");
  await createSolarman({ fetch: f, db: m.db, clock: fixedClock(NOW), env }).realTime("1");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].headers.Authorization, "bearer OLD");
});

test("faltando menos de 1 dia: renova", async () => {
  const f = fakeFetch([login, rt]);
  const m = memDb();
  await m.db.saveToken("solarman", "OLD", "2026-10-10T06:00:00Z");
  await createSolarman({ fetch: f, db: m.db, clock: fixedClock(NOW), env }).realTime("1");
  assert.match(f.calls[0].url, /token/);
  assert.equal(m.tokens.get("solarman")?.token, "TOK1");
});

test("token recusado: renova uma vez e repete", async () => {
  const f = fakeFetch([{ status: 401, body: {} }, login, rt]);
  const m = memDb();
  await m.db.saveToken("solarman", "OLD", "2026-12-01T00:00:00Z");
  const r = await createSolarman({ fetch: f, db: m.db, clock: fixedClock(NOW), env }).realTime("1");
  assert.equal(r.generationTotal, 20588.3);
  assert.equal(f.calls.length, 3);
});

test("token recusado de novo depois da renovação: erro, sem terceira tentativa", async () => {
  const bad = { body: { success: false, code: "2101019", msg: "access token invalid" } };
  const f = fakeFetch([bad, login, bad]);
  const m = memDb();
  await m.db.saveToken("solarman", "OLD", "2026-12-01T00:00:00Z");
  await assert.rejects(createSolarman({ fetch: f, db: m.db, clock: fixedClock(NOW), env }).realTime("1"), /realTime: code=2101019/);
  assert.equal(f.calls.length, 3);
});

test("auth failed: mensagem sem appId nem segredos", async () => {
  const f = fakeFetch([{ body: { success: false, code: "2101025", msg: "auth failed" } }]);
  const err = await createSolarman({ fetch: f, db: memDb().db, clock: fixedClock(NOW), env }).realTime("1").catch((e) => e);
  assert.equal(err.message, "/account/v1.0/token: code=2101025 msg=auth failed");
  assert.doesNotMatch(err.message, /APPID123|SECRETXYZ|a@b\.c/);
});

test("erro de rede: erro com o caminho", async () => {
  const f = fakeFetch([login, { throws: "connect ECONNREFUSED" }]);
  await assert.rejects(createSolarman({ fetch: f, db: memDb().db, clock: fixedClock(NOW), env }).realTime("1"),
    /\/station\/v1\.0\/realTime: rede: connect ECONNREFUSED/);
});

test("daily com mais de 31 dias: erro antes de chamar a API", async () => {
  const f = fakeFetch([]);
  await assert.rejects(createSolarman({ fetch: f, db: memDb().db, clock: fixedClock(NOW), env }).daily("1", "2026-01-01", "2026-02-15"),
    /31 dias/);
  assert.equal(f.calls.length, 0);
});

test("frames, daily e stations devolvem as listas", async () => {
  const f = fakeFetch([
    login,
    { body: { success: true, stationDataItems: [{ dateTime: 1791449100, generationPower: 0 }] } },
    { body: { success: true, stationDataItems: [{ year: 2026, month: 10, day: 8, generationValue: 19.8 }] } },
    { body: { success: true, stationList: [{ id: 1000001, name: "BSB" }] } },
  ]);
  const sm = createSolarman({ fetch: f, db: memDb().db, clock: fixedClock(NOW), env });
  assert.equal((await sm.frames("1000001", "2026-10-08")).length, 1);
  assert.deepEqual(f.calls[1].body, { stationId: 1000001, timeType: 1, startTime: "2026-10-08", endTime: "2026-10-08" });
  assert.equal((await sm.daily("1000001", "2026-10-01", "2026-10-08"))[0].generationValue, 19.8);
  assert.deepEqual(f.calls[2].body, { stationId: 1000001, timeType: 2, startTime: "2026-10-01", endTime: "2026-10-08" });
  assert.equal((await sm.stations())[0].id, 1000001);
  assert.deepEqual(f.calls[3].body, { page: 1, size: 20 });
});
