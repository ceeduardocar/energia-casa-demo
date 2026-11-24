import { test } from "node:test";
import assert from "node:assert/strict";
import { createTuya, sign } from "../tuya.ts";
import { fakeFetch, fixedClock, memDb } from "./fakes.ts";

const NOW = "2026-10-12T12:00:00Z";
const ENV = { clientId: "cid", secret: "sec", base: "https://openapi.tuyaus.com" };
const tokenReply = (token: string) => ({ body: { success: true, result: { access_token: token, expire_time: 7200 } } });
const shadowReply = { body: { success: true, result: { properties: [{ code: "power_a", value: 18, time: 1 }] } } };
const err = (code: number, msg: string) => ({ body: { success: false, code, msg } });

test("sign: HMAC-SHA256 em maiúsculas, sem token", () => {
  const s = sign({ clientId: "cid", secret: "sec", t: "1700000000000", method: "GET", path: "/v1.0/token?grant_type=1" });
  assert.equal(s, "0AF64305ACFB1B4FA821572257116648E4FB4F8C20FDB47A2DDEFC59B5C310DB");
});

test("sign: com token, o token entra antes do t", () => {
  const s = sign({ clientId: "cid", secret: "sec", t: "1700000000000", method: "GET", path: "/v2.0/cloud/thing/x/shadow/properties", token: "TOKEN" });
  assert.equal(s, "FCDB44AB61FE92835ED480DFC5476912AA418874451DE0C79F93EAC3B08024DF");
});

test("token salvo e válido não chama /token", async () => {
  const m = memDb();
  m.tokens.set("tuya", { token: "SAVED", expires_at: "2026-10-12T14:00:00Z" });
  const f = fakeFetch([shadowReply]);
  const props = await createTuya({ fetch: f, db: m.db, clock: fixedClock(NOW), env: ENV }).shadow("dev1");
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /\/v2\.0\/cloud\/thing\/dev1\/shadow\/properties$/);
  assert.equal(f.calls[0].headers.access_token, "SAVED");
  assert.equal(props[0].code, "power_a");
});

test("token vencendo (menos de 10 min) é renovado e salvo com a validade real", async () => {
  const m = memDb();
  m.tokens.set("tuya", { token: "OLD", expires_at: "2026-10-12T12:05:00Z" });
  const f = fakeFetch([tokenReply("NEW"), shadowReply]);
  await createTuya({ fetch: f, db: m.db, clock: fixedClock(NOW), env: ENV }).shadow("dev1");
  assert.match(f.calls[0].url, /\/v1\.0\/token\?grant_type=1$/);
  assert.equal(m.tokens.get("tuya")?.token, "NEW");
  assert.equal(m.tokens.get("tuya")?.expires_at, "2026-10-12T14:00:00.000Z");
});

test("code 1010 renova o token uma vez e tenta de novo", async () => {
  const m = memDb();
  const f = fakeFetch([tokenReply("T1"), err(1010, "token invalid"), tokenReply("T2"), shadowReply]);
  const props = await createTuya({ fetch: f, db: m.db, clock: fixedClock(NOW), env: ENV }).shadow("dev1");
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls[3].headers.access_token, "T2");
  assert.equal(props.length, 1);
});

test("code 1010 duas vezes: erro, sem terceira renovação", async () => {
  const m = memDb();
  const f = fakeFetch([tokenReply("T1"), err(1010, "token invalid"), tokenReply("T2"), err(1010, "token invalid")]);
  await assert.rejects(createTuya({ fetch: f, db: m.db, clock: fixedClock(NOW), env: ENV }).shadow("dev1"), /code=1010/);
  assert.equal(f.calls.length, 4);
});

test("outro erro: mensagem com código e caminho, sem token nem secret", async () => {
  const m = memDb();
  const f = fakeFetch([tokenReply("T1"), err(2009, "not support this device")]);
  await assert.rejects(
    createTuya({ fetch: f, db: m.db, clock: fixedClock(NOW), env: ENV }).shadow("dev1"),
    (e: Error) => /code=2009 msg=not support this device/.test(e.message) && !/T1|sec|sign/.test(e.message),
  );
});

test("GET nunca envia corpo (o runtime recusa 'GET with body')", async () => {
  const m = memDb();
  m.tokens.set("tuya", { token: "SAVED", expires_at: "2026-10-12T14:00:00Z" });
  const f = fakeFetch([shadowReply]);
  await createTuya({ fetch: f, db: m.db, clock: fixedClock(NOW), env: ENV }).shadow("dev1");
  // Se o cliente mandasse corpo no GET, o dublê lançaria antes de registrar a chamada.
  assert.equal(f.calls.length, 1);
});
