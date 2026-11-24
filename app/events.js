// Registro de eventos (piscina, visitas, equipamento...) e aviso de dias acima do normal.
import { esc, isNum, kwh, fmtDate, dow, dnum, addDays, spNow, daysBetween } from "./util.js";

// Tipos do formulário "outro evento". Carro e piscina têm controles próprios (cartões na Início).
export const KINDS = [["visitas", "Visitas"], ["equipamento", "Equipamento novo ou ligado"], ["outro", "Outro"]];
const NAMES = { piscina: "Bomba da piscina", carro: "Recarga do carro", visitas: "Visitas", equipamento: "Equipamento", outro: "Outro" };
const kindName = (k) => NAMES[k] || k;
const TZ_OFFSET_H = 3; // America/Sao_Paulo = UTC-3 (sem horario de verao desde 2019)
export const toIso = (date, time = "00:00") => `${date}T${time}:00-03:00`;
const shifted = (iso) => new Date(new Date(iso).getTime() - TZ_OFFSET_H * 3600e3).toISOString();
export const localDate = (iso) => shifted(iso).slice(0, 10);
export const localTime = (iso) => shifted(iso).slice(11, 16);

// Dias com consumo bem acima do normal: >= 30% e >= 4 kWh acima da mediana dos 14 dias anteriores.
export function anomalies(rows, from, to) {
  const byDay = new Map(rows.filter(r => isNum(r.consumo)).map(r => [r.day, r.consumo]));
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const v = byDay.get(d); if (!isNum(v)) continue;
    const prev = []; for (let k = 1; k <= 14; k++) { const x = byDay.get(addDays(d, -k)); if (isNum(x)) prev.push(x); }
    if (prev.length < 5) continue;
    prev.sort((a, b) => a - b); const mid = prev.length >> 1, med = prev.length % 2 ? prev[mid] : (prev[mid - 1] + prev[mid]) / 2;
    if (v >= med * 1.3 && v - med >= 4) out.push({ day: d, value: v, normal: med, pct: Math.round((v / med - 1) * 100) });
  }
  return out;
}

export function eventsHtml({ events, anoms, form, today, carDays = [], pool = null }) {
  anoms = anoms.filter(a => !carDays.includes(a.day));
  const generic = events.filter(e => e.kind !== "carro");
  const byDay = (d) => events.filter(e => localDate(e.started_at) === d);
  const when = (e) => { const d1 = localDate(e.started_at), t1 = localTime(e.started_at); if (!e.ended_at) return e.kind === "piscina" ? `desde ${fmtDate(d1)}, ${t1} (em andamento)` : `${fmtDate(d1)}, ${t1}`; const d2 = localDate(e.ended_at), t2 = localTime(e.ended_at); return d1 === d2 ? `${fmtDate(d1)}, ${t1} a ${t2}` : `${fmtDate(d1)} ${t1} a ${fmtDate(d2)} ${t2}`; };
  const poolHtml = pool ? `<div class="foot" style="text-align:left;padding:0 2px;color:var(--tx)">Bomba da piscina <b style="color:var(--amb,#ffc266)">ligada há ${Math.max(daysBetween(localDate(pool.started_at), today), 0)} dias</b> (desde ${fmtDate(localDate(pool.started_at))})</div>` : "";
  const carHtml = `<section class="card"><div class="top"><h2>Recargas do carro</h2><span class="unit">${carDays.length} no período</span></div>${carDays.length ? `<div class="list">${[...carDays].sort().reverse().map(d => `<div><span><b>${dow(d)} ${dnum(d)}</b> · ${fmtDate(d)}</span><button class="btn ghost" data-car-del="${d}" aria-label="Remover recarga" style="min-height:40px;min-width:40px;padding:6px 10px">×</button></div>`).join("")}</div>` : `<div class="empty">Nenhuma recarga marcada.</div>`}<form class="form" id="carForm" style="margin-top:10px;display:flex;gap:10px;align-items:flex-end"><label style="flex:1">Marcar outro dia<input type="date" name="d" max="${today}" required></label><button class="btn ghost" type="submit">Marcar</button></form></section>`;
  const anomHtml = anoms.length ? `<section class="card"><div class="top" style="margin-bottom:6px"><h2>Dias acima do normal</h2><span class="unit">vs. últimos 14 dias</span></div><div class="list">${anoms.map(a => { const ev = byDay(a.day); return `<div style="align-items:flex-start"><span><b>${dow(a.day)} ${dnum(a.day)}</b> · ${kwh(a.value, 1)} kWh <small style="color:var(--bad)">+${a.pct}%</small><br><small style="color:var(--mut)">normal: ${kwh(a.normal, 1)} kWh${ev.length ? ` · explicado: ${esc(ev.map(e => e.label || kindName(e.kind)).join(", "))}` : ""}</small></span>${ev.length ? "" : `<button class="btn ghost" data-explain="${a.day}" style="min-height:40px;padding:8px 12px;font-size:13px">Explicar</button>`}</div>`; }).join("")}</div></section>` : "";
  const list = generic.length ? `<div class="list">${generic.map(e => `<div style="align-items:flex-start"><span><b>${esc(e.label || (e.kind === "piscina" ? "Bomba ligada" : kindName(e.kind)))}</b> <small style="color:var(--mut)">· ${esc(kindName(e.kind))}</small><br><small style="color:var(--mut)">${when(e)}</small></span><button class="btn ghost" data-del="${esc(e.id)}" aria-label="Apagar evento" style="min-height:40px;min-width:40px;padding:6px 10px">×</button></div>`).join("")}</div>` : `<div class="empty">Nenhum evento neste período.</div>`;
  const f = form ? `<form class="form" id="evForm" style="margin-top:12px;border-top:1px solid var(--bd);padding-top:12px">
    <label>O que aconteceu?<select name="kind" required>${KINDS.map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></label>
    <label>Descrição (opcional)<input name="label" maxlength="80" placeholder="Ex.: bomba ligada 6h, visitas para o almoço"></label>
    <label>Dia<input type="date" name="date" value="${esc(form.date || today)}" max="${today}" required></label>
    <div style="display:flex;gap:10px"><label style="flex:1">Início<input type="time" name="t1" value="${esc(form.t1 || "08:00")}" required></label><label style="flex:1">Fim (opcional)<input type="time" name="t2"></label></div>
    <button class="btn" type="submit">Salvar evento</button><div class="foot" id="evMsg" role="status"></div></form>` : "";
  return `${poolHtml}${anomHtml}${carHtml}<section class="card"><div class="top"><h2>Eventos</h2><span class="unit">para explicar picos de consumo</span></div>${list}${form ? "" : `<button class="btn ghost" id="evAdd" style="width:100%;margin-top:10px">Registrar evento</button>`}${f}</section>`;
}

export function bindEvents({ root, api, state, go }) {
  const q = (s) => root.querySelector(s);
  const add = q("#evAdd"); if (add) add.onclick = () => { state.evForm = {}; go(); };
  root.querySelectorAll("[data-explain]").forEach(b => b.onclick = () => { state.evForm = { date: b.dataset.explain }; go(); setTimeout(() => document.getElementById("evForm")?.scrollIntoView({ behavior: "smooth", block: "center" }), 350); });
  root.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { try { await api.deleteEvent(b.dataset.del); go(); } catch (e) { alert(e.message); } });
  root.querySelectorAll("[data-car-del]").forEach(b => b.onclick = async () => { try { await api.setCar(b.dataset.carDel, false); go(); } catch (e) { alert(e.message); } });
  const cf = q("#carForm"); if (cf) cf.onsubmit = async (e) => { e.preventDefault(); try { await api.setCar(new FormData(cf).get("d"), true); go(); } catch (err) { alert(err.message); } };
  const f = q("#evForm"); if (!f) return;
  f.onsubmit = async (e) => {
    e.preventDefault(); const m = q("#evMsg"), d = new FormData(f), date = d.get("date"), t1 = d.get("t1"), t2 = d.get("t2");
    if (t2 && t2 <= t1) { m.textContent = "O fim precisa ser depois do início."; return; }
    try { m.textContent = "Salvando…"; await api.addEvent({ kind: d.get("kind"), label: (d.get("label") || "").trim() || null, started_at: toIso(date, t1), ended_at: t2 ? toIso(date, t2) : null }); state.evForm = null; go(); }
    catch (err) { m.textContent = "Não consegui salvar: " + err.message; }
  };
}

// Cartões rápidos da tela Início: carro (1 toque) e bomba da piscina (liga/desliga, sem data final).
export function quickHtml({ carToday, pool, today }) {
  const days = pool ? Math.max(daysBetween(localDate(pool.started_at), today), 0) : 0;
  return `<section class="card" aria-label="Registros rápidos"><div class="top"><h2>Registros rápidos</h2><span class="unit">para explicar o consumo</span></div>
    <div class="list">
      <div style="align-items:center"><span><b>Carro</b><br><small style="color:var(--mut)">${carToday ? "Recarga registrada hoje" : "Sem recarga hoje"}</small></span>${carToday ? `<button class="btn ghost" id="carOff" style="min-height:44px">Desfazer</button>` : `<button class="btn" id="carOn" style="min-height:44px">Carreguei hoje</button>`}</div>
      <div style="align-items:center"><span><b>Bomba da piscina</b><br><small style="color:var(--mut)">${pool ? `Ligada há ${days} ${days === 1 ? "dia" : "dias"}` : "Desligada"}</small></span>${pool ? `<button class="btn ghost" id="poolOff" style="min-height:44px">Desligar</button>` : `<button class="btn" id="poolOn" style="min-height:44px">Ligar</button>`}</div>
    </div></section>`;
}
export function bindQuick({ root, api, go, today, pool }) {
  const on = (id, fn) => { const b = root.querySelector(id); if (b) b.onclick = async () => { b.disabled = true; try { await fn(); go(); } catch (e) { b.disabled = false; alert("Não consegui salvar: " + e.message); } }; };
  on("#carOn", () => api.setCar(today, true));
  on("#carOff", () => api.setCar(today, false));
  on("#poolOn", () => api.poolOn());
  on("#poolOff", () => api.poolOff(pool.id));
}
