import { addDays } from "./util.js";
// supabase-js 2.45.4 (build UMD) fica em vendor/: o app não depende de CDN externo para abrir.
const loadLib = () => self.supabase ? Promise.resolve(self.supabase) : new Promise((ok, fail) => {
  const s = document.createElement("script"); s.src = "vendor/supabase.umd.js";
  s.onload = () => self.supabase ? ok(self.supabase) : fail(new Error("biblioteca do banco incompleta"));
  s.onerror = () => fail(new Error("não consegui carregar a biblioteca do banco")); document.head.appendChild(s);
});
export async function connect(cfg) {
  const { createClient } = await loadLib();
  const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  const ok = async (q) => { const { data, error } = await q; if (error) throw new Error(error.message); return data; };
  // Tabela/view ainda nao criada (plano das contas de luz): trata como lista vazia em vez de erro.
  const optional = async (q) => { const { data, error } = await q; if (error) { if (/PGRST20[45]|42P01|does not exist|schema cache/i.test(error.code + " " + error.message)) return []; throw new Error(error.message); } return data; };
  const api = {
    mode: "live", sb,
    async session() { const { data } = await sb.auth.getSession(); return data.session; },
    async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw new Error(error.message); },
    async signOut() { await sb.auth.signOut(); },
    async fetchNow() {
      const [now, status] = await Promise.all([ok(sb.from("v_now").select("*")), ok(sb.from("v_collector_status").select("*"))]);
      return { now, status, hourNow: null };
    },
    // Início inteiro em uma ida ao banco (função get_home): leituras de agora, hora a hora, autoconsumo, carro e bomba.
    async fetchHome(date) { const h = await ok(sb.rpc("get_home", { p_day: date })); return { now: h.now, status: h.status, hourly: h.hourly, self: h.self, car: !!h.car, pool: h.pool ?? null, hourNow: null }; },
    // Dispara o coletor agora (função SQL com limite de 30 s). { started, wait_s? }
    requestCollect: () => ok(sb.rpc("request_collect")),
    fetchHourly: (date) => ok(sb.from("v_house_hourly").select("*").gte("hour_local", `${date}T00:00:00`).lt("hour_local", `${addDays(date, 1)}T00:00:00`).order("hour_local")),
    fetchDaily: (from, to) => ok(sb.from("v_house_daily").select("*").gte("day", from).lte("day", to).order("day")),
    // Autoconsumo pelo injetado liquido; sem a view (migration nao aplicada) o app usa o calculo bruto.
    fetchSelfConsumption: (from, to) => optional(sb.from("v_self_consumption_daily").select("*").gte("day", from).lte("day", to).order("day")),
    async fetchCredits() { const r = await ok(sb.from("v_credits").select("*").limit(1)); return r[0] ?? null; },
    fetchBoiler: (from, to) => ok(sb.from("v_boiler_off_sun").select("*").gte("day", from).lte("day", to).order("day")),
    fetchEvents: (from, to) => optional(sb.from("events").select("*").gte("started_at", `${from}T00:00:00-03:00`).lte("started_at", `${to}T23:59:59-03:00`).order("started_at", { ascending: false })),
    async addEvent(ev) { await ok(sb.from("events").insert(ev)); },
    async fetchOpenPool() { const r = await optional(sb.from("events").select("*").eq("kind", "piscina").is("ended_at", null).limit(1)); return r[0] ?? null; },
    fetchPoolPeriods: (from, to) => optional(sb.from("events").select("*").eq("kind", "piscina").lte("started_at", `${to}T23:59:59-03:00`).or(`ended_at.is.null,ended_at.gte.${from}T00:00:00-03:00`)),
    async setCar(date, on) {
      const day = (d) => `${d}T00:00:00-03:00`, nxt = `${addDays(date, 1)}T00:00:00-03:00`;
      await ok(sb.from("events").delete().eq("kind", "carro").gte("started_at", day(date)).lt("started_at", nxt));
      if (on) await ok(sb.from("events").insert({ kind: "carro", started_at: `${date}T12:00:00-03:00` }));
    },
    async poolOn() { await ok(sb.from("events").insert({ kind: "piscina", started_at: new Date().toISOString() })); },
    async poolOff(id) { await ok(sb.from("events").update({ ended_at: new Date().toISOString() }).eq("id", id)); },
    async deleteEvent(id) { await ok(sb.from("events").delete().eq("id", id)); },
    async fetchBills() { return optional(sb.from("bills").select("*").order("reading_curr_date", { ascending: false })); },
    async fetchBillCheck() { return optional(sb.from("v_bill_check").select("*").order("reading_curr_date", { ascending: false })); },
    // Lê o PDF da Neoenergia no próprio aparelho; foto ou layout desconhecido -> null (digitar os campos).
    async parseBill(file) { const { parseBillFile } = await import("./billparse.js"); return parseBillFile(file); },
    async saveBill(b) {
      const { file_name, ...row } = b; delete row.example;
      for (const k of Object.keys(row)) if (row[k] === "") row[k] = null;
      const [saved] = await ok(sb.from("bills").insert({ ...row, confirmed_at: new Date().toISOString() }).select("id"));
      await ok(sb.from("credit_baseline").upsert({ as_of: b.reading_curr_date, balance_kwh: b.credit_balance_kwh, source: "bill", bill_id: saved.id }));
    },
    async saveBaseline(as_of, balance_kwh) { await ok(sb.from("credit_baseline").upsert({ as_of, balance_kwh, source: "manual" })); },
    fetchGridAudits: () => ok(sb.from("v_grid_audit_report").select("*").order("measured_at", { ascending: false })),
    async saveGridAudit(row) { await ok(sb.from("grid_meter_audits").insert(row)); },
    async deleteGridAudit(id) { await ok(sb.from("grid_meter_audits").delete().eq("id", id)); }
  };
  return api;
}
