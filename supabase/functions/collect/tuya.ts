// Cliente da Tuya Cloud (somente leitura): assinatura HMAC-SHA256, token com cache no banco
// e leitura do shadow do medidor (todos os códigos, inclusive os de canal).
// Nunca registra o secret, o sign nem o access_token em erros.
import { createHash, createHmac } from "node:crypto";
import type { Clock, Db, FetchFn } from "./types.ts";

export type TuyaEnv = { clientId: string; secret: string; base: string };
export type TuyaProperty = { code: string; value: unknown; time: number };
export interface Tuya {
  shadow(deviceId: string): Promise<TuyaProperty[]>;
}

const SOURCE = "tuya";
const RENEW_MS = 10 * 60_000;
const TOKEN_ERROR = 1010;

const sha256hex = (text: string) => createHash("sha256").update(text).digest("hex");

/** Assinatura: HMAC-SHA256 de client_id + token + t + (método, hash do corpo vazio, cabeçalhos vazios, caminho). */
export function sign(o: { clientId: string; secret: string; t: string; method: string; path: string; token?: string }): string {
  const stringToSign = [o.method, sha256hex(""), "", o.path].join("\n");
  return createHmac("sha256", o.secret).update(o.clientId + (o.token ?? "") + o.t + stringToSign).digest("hex").toUpperCase();
}

type Reply = { ok: boolean; code?: number; msg?: string; path: string; result?: unknown };

export function createTuya(o: { fetch: FetchFn; db: Db; clock: Clock; env: TuyaEnv }): Tuya {
  async function request(path: string, token?: string): Promise<Reply> {
    const t = String(o.clock());
    const headers: Record<string, string> = {
      client_id: o.env.clientId,
      sign: sign({ clientId: o.env.clientId, secret: o.env.secret, t, method: "GET", path, token }),
      t,
      sign_method: "HMAC-SHA256",
    };
    if (token) headers.access_token = token;
    const res = await o.fetch(o.env.base + path, { method: "GET", headers });
    const data = (await res.json()) as { success?: boolean; code?: number; msg?: string; result?: unknown };
    return { ok: res.ok && data.success === true, code: data.code, msg: data.msg, path: path.split("?")[0], result: data.result };
  }

  async function fetchToken(): Promise<string> {
    const r = await request("/v1.0/token?grant_type=1");
    if (!r.ok) throw new Error(`${r.path}: code=${r.code} msg=${r.msg}`);
    const { access_token, expire_time } = r.result as { access_token: string; expire_time: number };
    await o.db.saveToken(SOURCE, access_token, new Date(o.clock() + expire_time * 1000).toISOString());
    return access_token;
  }

  async function currentToken(forceNew = false): Promise<string> {
    if (!forceNew) {
      const saved = await o.db.getToken(SOURCE);
      if (saved && Date.parse(saved.expires_at) - o.clock() > RENEW_MS) return saved.token;
    }
    return fetchToken();
  }

  return {
    async shadow(deviceId) {
      const path = `/v2.0/cloud/thing/${deviceId}/shadow/properties`;
      let r = await request(path, await currentToken());
      if (!r.ok && r.code === TOKEN_ERROR) {
        // Token recusado: renova uma vez e tenta de novo. Sem laço.
        r = await request(path, await currentToken(true));
      }
      if (!r.ok) throw new Error(`${r.path}: code=${r.code} msg=${r.msg}`);
      return (r.result as { properties: TuyaProperty[] }).properties;
    },
  };
}
