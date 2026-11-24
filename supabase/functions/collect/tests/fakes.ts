// Dublês para os testes: fetch com fila de respostas e banco em memória.
import type { Db, FetchFn, MapRow, Reading, Run } from "../types.ts";

export type FakeReply = { status?: number; body?: unknown; throws?: string };
export type FakeCall = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

export function fakeFetch(replies: FakeReply[]): FetchFn & { calls: FakeCall[] } {
  const queue = [...replies];
  const calls: FakeCall[] = [];
  const fn = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    if (init.method === "GET" && init.body !== undefined) throw new Error("Request with GET/HEAD method cannot have body");
    calls.push({ url, headers: init.headers, body: (init.body ? JSON.parse(init.body) : {}) });
    const r = queue.shift();
    if (!r) throw new Error("fakeFetch: sem resposta para " + url);
    if (r.throws) throw new Error(r.throws);
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body ?? {} };
  };
  return Object.assign(fn, { calls });
}

/** Responde pela rota (parte da URL depois do host, sem query), para testes com muitas chamadas. */
export function routeFetch(route: (path: string, body: Record<string, unknown>) => unknown): FetchFn & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fn = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const body = (init.body ? JSON.parse(init.body) : {});
    calls.push({ url, headers: init.headers, body });
    const path = new URL(url).pathname;
    return { ok: true, status: 200, json: async () => route(path, body) };
  };
  return Object.assign(fn, { calls });
}

export function memDb(init: { settings?: Record<string, string>; externalId?: string | null; map?: MapRow[] } = {}) {
  const readings = new Map<string, Reading>();
  const settings = new Map(Object.entries(init.settings ?? {}));
  const tokens = new Map<string, { token: string; expires_at: string }>();
  const external = new Map<string, string | null>([["solar_plant", init.externalId ?? null]]);
  const runs: Run[] = [];
  const series = (d: string, m: string) =>
    [...readings.values()].filter((r) => r.device_id === d && r.metric === m).sort((a, b) => a.ts.localeCompare(b.ts));
  const db: Db = {
    async getToken(s) { return tokens.get(s) ?? null; },
    async saveToken(s, token, expires_at) { tokens.set(s, { token, expires_at }); },
    async metricMap() { return init.map ?? []; },
    async getExternalId(d) { return external.get(d) ?? null; },
    async setExternalId(d, id) { external.set(d, id); },
    async insertReadings(rows) {
      let n = 0;
      for (const r of rows) {
        const k = `${r.device_id}|${r.metric}|${r.ts}`;
        if (!readings.has(k)) { readings.set(k, r); n++; }
      }
      return n;
    },
    async lastReading(d, m) { const s = series(d, m).at(-1); return s ? { ts: s.ts, value: s.value } : null; },
    async firstReading(d, m) { const s = series(d, m)[0]; return s ? { ts: s.ts, value: s.value } : null; },
    async getSetting(k) { return settings.get(k) ?? null; },
    async setSetting(k, v) { settings.set(k, v); },
    async logRun(r) { runs.push(r); },
  };
  return { db, readings, settings, tokens, external, runs, series };
}

export const fixedClock = (iso: string) => () => Date.parse(iso);
