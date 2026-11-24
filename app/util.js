export const TZ = "America/Sao_Paulo";
const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function spNow() {
  const p = Object.fromEntries(dtf.formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, minute: +p.minute };
}
export const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
const MES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const DIA = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
export const mesNome = m => MES[m];
export const mesCurto = m => MES[m].slice(0, 3);
export const dow = d => DIA[new Date(d + "T00:00:00Z").getUTCDay()];
export const dnum = d => +d.slice(8, 10);
export const fmtDate = d => `${dnum(d)} de ${MES[+d.slice(5, 7) - 1]}`;
const nf = (min, max) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: min, maximumFractionDigits: max });
const n0 = nf(0, 0), n1 = nf(1, 1), n2 = nf(2, 2);
export const isNum = v => typeof v === "number" && isFinite(v);
export const kwh = (v, dec) => !isNum(v) ? "—" : dec === 2 ? n2.format(v) : dec === 0 ? n0.format(v) : (Math.abs(v) >= 100 ? n0 : n1).format(v);
// Evita que um consumo positivo pequeno pareça zero.
export const kwhPrecise = (v, dec = 1) => {
  if (!isNum(v)) return "—";
  const digits = Math.max(0, Math.min(2, dec));
  const threshold = 10 ** -digits;
  if (v > 0 && v < threshold) return `< ${nf(digits, digits).format(threshold)}`;
  return (digits === 2 ? n2 : digits === 1 ? n1 : n0).format(v);
};
export function power(w) {
  if (!isNum(w)) return { v: "—", u: "" };
  return Math.abs(w) >= 1000 ? { v: n2.format(w / 1000), u: "kW" } : { v: n0.format(w), u: "W" };
}
export const pct = v => !isNum(v) ? "—" : n0.format(v * 100) + "%";
export const brl = v => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Autoconsumo do dia. Usa o injetado liquido (o que a Neoenergia registra) quando a view
// v_self_consumption_daily o considera confiavel; senao cai no injetado bruto do Tuya e marca estimated.
export function selfUse(row, g, eGross) {
  if (row && isNum(row.injected_kwh) && isNum(row.self_kwh)) return { injected: row.injected_kwh, self: row.self_kwh, pct: isNum(row.self_pct) ? row.self_pct : null, estimated: !row.net_ok };
  if (!isNum(g) || !isNum(eGross)) return { injected: isNum(eGross) ? eGross : null, self: null, pct: null, estimated: true };
  const self = Math.max(g - eGross, 0);
  return { injected: eGross, self, pct: g > 0 ? self / g : null, estimated: true };
}
export const sum = (rows, k) => { let t = 0, any = false; for (const r of rows) if (isNum(r[k])) { t += r[k]; any = true; } return any ? t : null; };
const hm = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const hhmm = iso => { const t = Date.parse(iso); return isFinite(t) ? hm.format(t) : ""; };

// Fluxo "Agora": junta a geração (Solarman) e a rede (Tuya), que chegam de relógios diferentes,
// sem mostrar um consumo que as leituras não sustentam. Consumo = geração - injeção (ou + importação).
// Leitura velha ou conta negativa além do ruído (leituras de horários diferentes) viram consumo nulo
// com o motivo, em vez de um "0 W" cortado.
export function agoraFlow({ g, gAge, solarPaused = false, grid, gridAge, exporting, staleMin = 12, noiseW = 150 }) {
  const gv = solarPaused ? 0 : g;
  const out = { g: gv, grid, exporting, gAge: solarPaused ? null : gAge, gridAge, consumo: null, reason: null };
  if (!isNum(gv) || !isNum(grid)) { out.reason = "sem-dado"; return out; }
  if (!solarPaused && gAge > staleMin) { out.reason = "aguardando-solar"; return out; }
  if (gridAge > staleMin) { out.reason = "aguardando-rede"; return out; }
  const c = gv + (exporting ? -grid : grid);
  if (c < -noiseW) { out.reason = "nao-fecham"; return out; }
  out.consumo = Math.max(c, 0);
  return out;
}
export const ageText = (min) => !isNum(min) ? "" : min < 1 ? "agora" : min < 60 ? `há ${Math.round(min)} min` : `há ${Math.floor(min / 60)} h`;
// Dia ou noite para a ilustração da casa (hora de Brasília).
export const sunUp = (hour) => hour >= 6 && hour < 18;
