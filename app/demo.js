// Dados de exemplo no MESMO formato das views do banco (Plano 1).
import { spNow, addDays, daysBetween } from "./util.js";
const rnd = (seed) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const solarKw = h => Math.max(0, Math.sin(Math.PI * (h + 0.5 - 6) / 12)) * 1.95;
function hourRow(date, h, r) {
  const cloud = 0.75 + 0.25 * r();
  const g = +(solarKw(h) * cloud).toFixed(3);
  const bo = (h >= 6 && h <= 8 && r() > 0.45) ? +(0.9 + r() * 1.9).toFixed(3) : (h >= 11 && h <= 14 && r() > 0.6 ? +(0.6 + r()).toFixed(3) : 0);
  const ac = (h >= 13 && h <= 17) || h >= 21 || h <= 5 ? +((h >= 21 || h <= 5 ? 0.35 : 0.7) * (0.6 + r() * 0.8)).toFixed(3) : 0;
  const outros = +(0.18 + 0.12 * r() + (h >= 18 && h <= 22 ? 0.25 : 0)).toFixed(3);
  const consumo = +(ac + bo + outros).toFixed(3);
  const auto = Math.min(g, consumo), e = +Math.max(g - consumo, 0).toFixed(3), i = +Math.max(consumo - g, 0).toFixed(3);
  return { hour_local: `${date}T${String(h).padStart(2, "0")}:00:00`, g, i, e, ac, bo, consumo, outros, _auto: auto };
}
const hoursOf = (date) => { const r = rnd([...date].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 2147483646 + 1); return Array.from({ length: 24 }, (_, h) => hourRow(date, h, r)); };
function dayRow(date, upto = 23) {
  const hs = hoursOf(date).slice(0, upto + 1);
  const t = k => +hs.reduce((a, x) => a + x[k], 0).toFixed(3);
  const g = t("g"), i = t("i"), e = t("e"), ac = t("ac"), bo = t("bo"), consumo = +(g + i - e).toFixed(3);
  const autoc = +(g - e).toFixed(3);
  return { day: date, g, i, e, ac, bo, consumo, autoconsumo: autoc, autossuficiencia: consumo > 0 ? autoc / consumo : 0, outros: +Math.max(consumo - ac - bo, 0).toFixed(3) };
}
export const demo = {
  mode: "demo",
  async fetchNow() {
    const n = spNow(), h = hoursOf(n.date)[n.hour], k = 1000, j = 1 + (Math.random() - .5) * .06;
    const net = h.consumo - h.g, grid = Math.abs(net) * k * j;
    const row = (device_id, metric, value) => ({ device_id, metric, value, ts: new Date().toISOString(), age_minutes: 2, is_stale: false });
    return {
      now: [row("solar_plant", "power_w", h.g * k * j), row("grid_meter", "power_w", grid), row("grid_meter", "power_signed_w", net * k * j), row("appliance_ac", "power_w", h.ac * k * j), row("appliance_boiler", "power_w", h.bo * k * j)],
      status: [{ source: "solarman", ok: true, started_at: new Date().toISOString(), age_minutes: 2 }, { source: "tuya", ok: true, started_at: new Date().toISOString(), age_minutes: 2 }],
      hourNow: h
    };
  },
  async fetchHourly(date) { const n = spNow(); let rows = hoursOf(date); if (date === n.date) rows = rows.slice(0, n.hour + 1); if (date > n.date) rows = []; return rows; },
  async fetchDaily(from, to) { const n = spNow(), out = []; for (let d = from; d <= to; d = addDays(d, 1)) { if (d > n.date) break; out.push(dayRow(d, d === n.date ? n.hour : 23)); } return out; },
  async fetchSelfConsumption(from, to) {
    return (await this.fetchDaily(from, to)).map(d => ({ day: d.day, generation_kwh: d.g, injected_kwh: d.e, self_kwh: d.autoconsumo, self_pct: d.g > 0 ? d.autoconsumo / d.g : null, net_ok: true }));
  },
  async fetchHome(date) {
    const [n, hourly, self, evs, pool] = await Promise.all([this.fetchNow(), this.fetchHourly(date), this.fetchSelfConsumption(date, date), this.fetchEvents(date, date), this.fetchOpenPool()]);
    return { now: n.now, status: n.status, hourly, self, car: evs.some(e => e.kind === "carro"), pool, hourNow: n.hourNow };
  },
  async fetchCredits() {
    const n = spNow(), as_of = addDays(n.date, -8), base = 2038.67;
    const days = await this.fetchDaily(addDays(as_of, 1), n.date);
    // Mesma regra da v_credits: os primeiros 100 kWh importados no ciclo são o mínimo faturado.
    const ex = days.reduce((a, d) => a + d.e, 0), im = days.reduce((a, d) => a + d.i, 0), comp = Math.max(im - 100, 0), bal = base + ex - comp;
    const nd = Math.max(days.length, 1), drain = Math.max((im / nd) * 30 - 100, 0) / 30 - ex / nd;
    return { as_of, base_kwh: base, exported_kwh: ex, imported_kwh: im, balance_kwh: bal, avg_net_drain_kwh_per_day: drain, days_left: drain > 0 ? bal / drain : null, min_billed_kwh: 100, compensated_kwh: comp, cycle_start: as_of, cycle_imported_kwh: im };
  },
  async fetchBoiler(from, to) { const d = await this.fetchDaily(from, to); return d.map(x => ({ day: x.day, boiler_kwh_off_sun: x.bo * 0.55, boiler_kwh_total: x.bo })); },
  _events: null,
  async fetchEvents(from, to) {
    const { toIso, localDate } = await import("./events.js");
    if (!this._events) { const n = spNow().date; this._events = [
      { id: "d1", kind: "piscina", label: "Bomba ligada", started_at: toIso("2026-01-10", "08:00"), ended_at: toIso("2026-08-21", "09:20") },
      { id: "d3", kind: "carro", label: null, started_at: toIso(addDays(n, -3), "20:00"), ended_at: null },
      { id: "d4", kind: "carro", label: null, started_at: toIso(addDays(n, -6), "21:00"), ended_at: null },
      { id: "d2", kind: "visitas", label: "Almoço com visitas", started_at: toIso(addDays(n, -2), "12:00"), ended_at: toIso(addDays(n, -2), "16:00") }]; }
    return this._events.filter(e => { const d = localDate(e.started_at); return d >= from && d <= to; }).sort((a, b) => b.started_at.localeCompare(a.started_at));
  },
  async addEvent(ev) { await this.fetchEvents("2000-01-01", "2000-01-02"); this._events.push({ ...ev, id: "e" + Date.now() }); },
  async fetchOpenPool() { await this.fetchEvents("2000-01-01", "2000-01-02"); return this._events.find(e => e.kind === "piscina" && !e.ended_at) || null; },
  async fetchPoolPeriods(from, to) { const { localDate } = await import("./events.js"); await this.fetchEvents("2000-01-01", "2000-01-02"); return this._events.filter(e => e.kind === "piscina" && localDate(e.started_at) <= to && (!e.ended_at || localDate(e.ended_at) >= from)); },
  async setCar(date, on) { await this.fetchEvents("2000-01-01", "2000-01-02"); const { localDate, toIso } = await import("./events.js"); this._events = this._events.filter(e => !(e.kind === "carro" && localDate(e.started_at) === date)); if (on) this._events.push({ id: "c" + Date.now(), kind: "carro", label: null, started_at: toIso(date, "12:00"), ended_at: null }); },
  async poolOn() { await this.fetchEvents("2000-01-01", "2000-01-02"); this._events.push({ id: "p" + Date.now(), kind: "piscina", label: null, started_at: new Date().toISOString(), ended_at: null }); },
  async poolOff(id) { const e = this._events.find(x => x.id === id); if (e) e.ended_at = new Date().toISOString(); },
  async deleteEvent(id) { this._events = (this._events || []).filter(e => e.id !== id); },
  _bills: null,
  async fetchBills() { if (!this._bills) { const { SAMPLE } = await import("./bills.js"); const hist = [["2026-05", 406, 251, null], ["2026-06", 435, 139.67, null], ["2026-07", 505, 175, null], ["2026-08", 310, 212, 1938.67]]; this._bills = [...hist.map(([ref, c, inj, bal]) => ({ access_key: "DEMO-" + ref, ref_month: ref + "-01", kwh_measured: c, kwh_injected: inj, kwh_billed: 100, credit_balance_kwh: bal })), { ...SAMPLE(), confirmed_at: new Date().toISOString() }]; } return this._bills; },
  async fetchBillCheck() { return [{ ref_month: "2026-11", reading_prev_date: "2026-10-07", reading_curr_date: "2026-11-06", days: 30, coverage: 0.998, house_import_kwh: 318.4, bill_import_kwh: 312.0, house_export_kwh: 308.6, bill_export_kwh: 312.0, status: "ok", example: true }]; },
  async parseBill(file) {
    // Um PDF real da Neoenergia é lido de verdade (nada é gravado); qualquer outro arquivo vira a conta de exemplo.
    try { const { parseBillFile } = await import("./billparse.js"); const b = file && await parseBillFile(file); if (b) return b; } catch {}
    const { SAMPLE } = await import("./bills.js"); return { ...SAMPLE(), access_key: "DEMO-" + Math.random().toString(36).slice(2, 8) };
  },
  async saveBill(b) { const cur = await this.fetchBills(); this._bills = [{ ...b, confirmed_at: new Date().toISOString() }, ...cur.filter(x => x.access_key !== b.access_key)]; },
  async saveBaseline() { throw new Error("Modo demonstração: nada é gravado."); },
  async signOut() {}
};
