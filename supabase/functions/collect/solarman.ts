// Cliente da Solarman OpenAPI (somente leitura). Token guardado em api_tokens.
// Mensagens de erro citam só o caminho (sem appId) e nunca valores de segredo.
import type { Clock, DailyItem, Db, FetchFn, Frame, RealTime, Solarman, SolarmanEnv, Station } from "./types.ts";

const BASE = "https://globalapi.solarmanpv.com";
const SOURCE = "solarman";
const RENEW_BEFORE_MS = 24 * 3600 * 1000; // token dura ~60 dias; renova com menos de 1 dia

type Body = Record<string, unknown> & { success?: boolean; code?: unknown; msg?: unknown };

class TokenRejected extends Error {}

export function createSolarman(opts: { fetch: FetchFn; db: Db; clock: Clock; env: SolarmanEnv }): Solarman {
  const { fetch, db, clock, env } = opts;

  async function post(path: string, query: string, body: unknown, token?: string): Promise<Body> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "bearer " + token;
    let res;
    try {
      res = await fetch(`${BASE}${path}?${query}`, { method: "POST", headers, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error(`${path}: rede: ${(e as Error).message}`);
    }
    const data = ((await res.json().catch(() => ({}))) ?? {}) as Body;
    if (token && (res.status === 401 || (data.success === false && /token/i.test(String(data.msg ?? ""))))) {
      throw new TokenRejected(`${path}: code=${data.code ?? res.status} msg=${data.msg ?? "token recusado"}`);
    }
    if (!res.ok || data.success === false) {
      throw new Error(`${path}: code=${data.code ?? res.status} msg=${data.msg ?? "-"}`);
    }
    return data;
  }

  async function login(): Promise<string> {
    const data = await post("/account/v1.0/token", `appId=${encodeURIComponent(env.appId)}&language=en`, {
      appSecret: env.appSecret,
      email: env.email,
      password: env.passwordSha256,
    });
    const token = data.access_token;
    if (typeof token !== "string" || !token) throw new Error("/account/v1.0/token: resposta sem access_token");
    const ttl = Number(data.expires_in) || 0;
    await db.saveToken(SOURCE, token, new Date(clock() + ttl * 1000).toISOString());
    return token;
  }

  async function token(): Promise<string> {
    const saved = await db.getToken(SOURCE);
    if (saved && Date.parse(saved.expires_at) - clock() > RENEW_BEFORE_MS) return saved.token;
    return login();
  }

  /** Chamada autenticada; se o token for recusado, renova uma vez e repete. */
  async function call(path: string, body: unknown): Promise<Body> {
    try {
      return await post(path, "language=en", body, await token());
    } catch (e) {
      if (!(e instanceof TokenRejected)) throw e;
      return post(path, "language=en", body, await login());
    }
  }

  const list = <T>(data: Body, key: string): T[] => (Array.isArray(data[key]) ? (data[key] as T[]) : []);

  return {
    async stations() {
      return list<Station>(await call("/station/v1.0/list", { page: 1, size: 20 }), "stationList");
    },
    async realTime(stationId) {
      return (await call("/station/v1.0/realTime", { stationId: Number(stationId) })) as RealTime;
    },
    async frames(stationId, day) {
      const data = await call("/station/v1.0/history", { stationId: Number(stationId), timeType: 1, startTime: day, endTime: day });
      return list<Frame>(data, "stationDataItems");
    },
    async daily(stationId, from, to) {
      const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
      if (!(days >= 1 && days <= 31)) throw new Error(`daily: intervalo de ${days} dias (máximo 31 dias)`);
      const data = await call("/station/v1.0/history", { stationId: Number(stationId), timeType: 2, startTime: from, endTime: to });
      return list<DailyItem>(data, "stationDataItems");
    },
  };
}
