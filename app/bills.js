// Regras de conferencia da conta (as mesmas da spec, secao 5.1) - funcoes puras.
import { daysBetween, isNum } from "./util.js";
export const num = (v) => { if (typeof v === "number") return v; const s = String(v ?? "").trim(); if (!s) return null; const n = parseFloat(s.includes(",") || /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s); return isFinite(n) ? n : null; };
export const measured = (b) => isNum(num(b.meter_reading_curr)) && isNum(num(b.meter_reading_prev)) ? +((num(b.meter_reading_curr) - num(b.meter_reading_prev)) * (num(b.meter_constant) ?? 1)).toFixed(3) : null;
export const itemsSum = (b) => ["tusd_brl", "te_brl", "flag_brl", "interest_brl", "fine_brl", "public_lighting_brl", "other_brl"].reduce((a, k) => a + (num(b[k]) ?? 0), 0);
// Cada verificacao: {id, label, ok, fields:[campos destacados quando falha]}
export function checks(b, existingKeys = []) {
  const m = measured(b), d = (b.reading_prev_date && b.reading_curr_date) ? daysBetween(b.reading_prev_date, b.reading_curr_date) : null;
  return [
    { id: "days", label: "Dias = diferença entre as leituras", ok: d != null && d === num(b.days), fields: ["days", "reading_prev_date", "reading_curr_date"] },
    { id: "billed", label: "Medido + ajuste CAT = faturado", ok: m != null && isNum(num(b.kwh_adjust_cat)) && Math.abs(m + num(b.kwh_adjust_cat) - num(b.kwh_billed)) < 0.001, fields: ["kwh_billed", "kwh_adjust_cat", "meter_reading_curr", "meter_reading_prev"] },
    { id: "sum", label: "Soma dos valores = total a pagar", ok: isNum(num(b.total_brl)) && Math.abs(itemsSum(b) - num(b.total_brl)) < 0.011, fields: ["total_brl", "tusd_brl", "te_brl", "flag_brl", "public_lighting_brl", "other_brl"] },
    { id: "dates", label: "Datas em ordem (anterior < atual < próxima)", ok: !!(b.reading_prev_date && b.reading_curr_date && b.reading_prev_date < b.reading_curr_date && (!b.next_reading_date || b.reading_curr_date < b.next_reading_date)), fields: ["reading_prev_date", "reading_curr_date", "next_reading_date"] },
    { id: "dup", label: "Conta ainda não importada", ok: !b.access_key || !existingKeys.includes(b.access_key), fields: ["access_key"] }
  ];
}
export const SAMPLE = () => ({
  access_key: "DEMO-0001", ref_month: "2026-09", meter_number: "1234567", file_name: "conta-neoenergia-09-2026.pdf", extraction_method: "pdf_text",
  reading_prev_date: "2026-08-07", reading_curr_date: "2026-09-09", next_reading_date: "2026-10-07", days: 33,
  meter_reading_prev: 14482, meter_reading_curr: 14794, meter_constant: 1, kwh_adjust_cat: -212, kwh_billed: 100, kwh_injected: 312, kwh_reactive: 312, credit_balance_kwh: 2038.67,
  tusd_brl: 38.6, te_brl: 52.4, flag_brl: 12.26, interest_brl: 0, fine_brl: 0, public_lighting_brl: 32.14, total_brl: 135.4,
  consumption_history: Array.from({ length: 12 }, (_, i) => { const t = new Date(Date.UTC(2025, 8 + i, 1)); return { ref_month: t.toISOString().slice(0, 7), kwh: 100, days: 30 }; })
});
