// Edge Function `collect` (Deno). Chamada a cada 5 min pelo pg_cron (supabase/cron_collect.sql);
// à noite, com corpo {"mode":"backfill"}, só avança o backfill (supabase/cron_backfill.sql).
// Só roda com o cabeçalho x-collect-secret igual ao segredo `collect_secret` do Vault,
// conferido pela função SQL public.collect_secret_ok (só o service_role a executa).
// Cada fonte tem o seu segredo: se faltar um, só essa fonte falha (fica em collector_runs).
import { createClient } from "npm:@supabase/supabase-js@2";
import type { Db, FetchFn, MapRow, Reading } from "./types.ts";
import { createSolarman } from "./solarman.ts";
import { collectLive } from "./live.ts";
import { backfillStep } from "./backfill.ts";
import { createTuya } from "./tuya.ts";
import { collectTuya } from "./tuya_live.ts";
import { runAll } from "./run.ts";
import { inSolarWindow } from "./time.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

const db: Db = {
  async getToken(source) {
    return must(await sb.from("api_tokens").select("token, expires_at").eq("source", source).maybeSingle(), "api_tokens");
  },
  async saveToken(source, token, expires_at) {
    must(await sb.from("api_tokens").upsert({ source, token, expires_at }), "api_tokens");
  },
  async metricMap(source) {
    return must(
      await sb.from("device_metric_map").select("external_id, source_code, device_id, metric, scale").eq("source", source),
      "device_metric_map",
    ) as MapRow[];
  },
  async getExternalId(id) {
    return must(await sb.from("devices").select("external_id").eq("id", id).single(), "devices").external_id ?? null;
  },
  async setExternalId(id, external_id) {
    must(await sb.from("devices").update({ external_id }).eq("id", id), "devices");
  },
  async insertReadings(rows: Reading[]) {
    if (!rows.length) return 0;
    const data = must(
      await sb.from("readings").upsert(rows, { onConflict: "device_id,metric,ts", ignoreDuplicates: true }).select("ts"),
      "readings",
    );
    return data?.length ?? 0;
  },
  async lastReading(d, m) {
    return must(await sb.from("readings").select("ts, value").eq("device_id", d).eq("metric", m)
      .order("ts", { ascending: false }).limit(1).maybeSingle(), "readings");
  },
  async firstReading(d, m) {
    return must(await sb.from("readings").select("ts, value").eq("device_id", d).eq("metric", m)
      .order("ts", { ascending: true }).limit(1).maybeSingle(), "readings");
  },
  async getSetting(key) {
    return must(await sb.from("settings").select("value").eq("key", key).maybeSingle(), "settings")?.value ?? null;
  },
  async setSetting(key, value) {
    must(await sb.from("settings").upsert({ key, value }), "settings");
  },
  async logRun(run) {
    must(await sb.from("collector_runs").insert(run), "collector_runs");
  },
};

const SOLAR_ENV = ["SOLARMAN_APP_ID", "SOLARMAN_APP_SECRET", "SOLARMAN_EMAIL", "SOLARMAN_PASSWORD_SHA256"];
const TUYA_ENV = ["TUYA_CLIENT_ID", "TUYA_SECRET"];
const missingOf = (keys: string[]) => keys.filter((k) => !Deno.env.get(k));
const need = <T>(client: T | null, missing: string[]): T => {
  if (!client) throw new Error("secret ausente: " + missing.join(", "));
  return client;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("método não permitido", { status: 405 });
  const secret = req.headers.get("x-collect-secret") ?? "";
  const okSecret = secret && must(await sb.rpc("collect_secret_ok", { s: secret }), "collect_secret_ok") === true;
  if (!okSecret) return new Response("não autorizado", { status: 401 });

  const body = await req.json().catch(() => ({})) as { mode?: string };
  const mode = body?.mode === "backfill" ? "backfill" : "all";
  const num = async (k: string, d: number) => Number(await db.getSetting(k)) || d;

  const missingSolar = missingOf(SOLAR_ENV);
  const sm = missingSolar.length ? null : createSolarman({
    fetch: fetch as unknown as FetchFn,
    db,
    clock: Date.now,
    env: {
      appId: Deno.env.get("SOLARMAN_APP_ID")!,
      appSecret: Deno.env.get("SOLARMAN_APP_SECRET")!,
      email: Deno.env.get("SOLARMAN_EMAIL")!,
      passwordSha256: Deno.env.get("SOLARMAN_PASSWORD_SHA256")!.toLowerCase(),
    },
  });

  const missingTuya = missingOf(TUYA_ENV);
  const tuya = missingTuya.length ? null : createTuya({
    fetch: fetch as unknown as FetchFn,
    db,
    clock: Date.now,
    env: {
      clientId: Deno.env.get("TUYA_CLIENT_ID")!,
      secret: Deno.env.get("TUYA_SECRET")!,
      base: Deno.env.get("TUYA_BASE") ?? "https://openapi.tuyaus.com",
    },
  });

  const results = await runAll({
    db,
    mode,
    liveTimeoutMs: 25_000,
    backfillTimeoutMs: 90_000,
    sources: [
      {
        name: "solarman",
        // Fora da janela diurna a Solarman não é devida nesta rodada (null): não grava em collector_runs.
        live: async () => {
          const client = need(sm, missingSolar);
          if (!inSolarWindow(Date.now())) return null;
          return collectLive({ sm: client, db, maxPowerW: await num("solar_max_power_w", 6000) });
        },
        backfill: async () => backfillStep({ sm: need(sm, missingSolar), db, clock: Date.now, daysPerRun: await num("solarman_backfill_days_per_run", 10) }),
      },
      {
        // Medidor geral: pode passar do teto solar (casa com ar-condicionado), por isso o teto próprio.
        name: "tuya",
        live: async () => collectTuya({ tuya: need(tuya, missingTuya), db, maxPowerW: await num("tuya_max_power_w", 15000), applianceMinW: await num("appliance_min_power_w", 10) }),
      },
    ],
  });
  return Response.json({ ok: results.every((r) => r.ok), written: results.reduce((s, r) => s + r.written, 0) });
});
