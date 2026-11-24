import { spNow, hhmm, addDays, daysBetween, mesNome, mesCurto, dow, dnum, fmtDate, kwh, kwhPrecise, power, pct, brl, esc, sum, isNum, selfUse, agoraFlow, ageText } from "./util.js";
import { hourlyLines, groupedBars, stackedHourly, sparkline, bindCharts, carIcon } from "./charts.js";
import { demo } from "./demo.js";
import { makeContas } from "./contas.js";
import { makeHouseHtml } from "./house-view.js";
import { creditMonths, balanceChecks } from "./credits-months.js";
import { creditsHtml } from "./credits-html.js";
import { localDate } from "./events.js";
import { eventsHtml, bindEvents, anomalies, quickHtml, bindQuick } from "./events.js";
import { makeAssistente } from "./assistente.js";

const cfg = window.ENERGIA_CONFIG || {};
const LIVE = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
const $app = document.getElementById("app");
// Cores de dado: âmbar = solar, ciano = consumo, verde = rede, violeta = ar-cond., rosa = boiler. Botões, abas e links usam o branco-gelo (--ui).
const C = { amb: "#FFC266", cy: "#5FD4F0", grid: "#7BE0A0", ui: "#EEF5FA", vio: "#A78BFA", pink: "#F472B6", sl: "#8FA9BC" };
let api = demo;
const state = { tab: "dia", anchor: null, route: "inicio" };

const ic = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  dollar: '<path d="M12 2v20M17 6.5C16 5 14 4.5 12 4.5c-2.6 0-4.5 1.2-4.5 3.2 0 4.5 9 2.5 9 7.1 0 2-2 3.2-4.5 3.2-2.2 0-4.2-.8-5.2-2.5"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  cube: '<path d="M12 2l8 4.5v10L12 22l-8-5.5v-10zM4 6.5l8 5 8-5M12 11.5V22"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  chev: '<path d="M9 5l7 7-7 7"/>', left: '<path d="M15 5l-7 7 7 7"/>',
  flame: '<path d="M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1.5.7-2.5 1.5-3.5C9.7 9.5 11 8 12 3z"/>',
  doc: '<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>', up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  snow: '<path d="M12 2v20M4.9 7l14.2 10M19.1 7L4.9 17M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5"/>',
  pool: '<path d="M3 17c2 0 2-1.5 4-1.5S9 17 11 17s2-1.5 4-1.5 2 1.5 4 1.5M3 12c2 0 2-1.5 4-1.5S9 12 11 12s2-1.5 4-1.5 2 1.5 4 1.5M8 8V5a2 2 0 0 1 4 0"/>',
  car: '<path d="M5 17h14M3 13l2-6h14l2 6v4H3zM7 17v2M17 17v2"/>'
};
const svg = (n, s = 22, c = "currentColor", w = 1.8) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ic[n]}</svg>`;

const TABS = [["inicio", "Início", "home"], ["casa", "Casa", "cube"], ["historico", "Histórico", "chart"], ["creditos", "Créditos", "dollar"], ["ajustes", "Ajustes", "sliders"]];
const tabbar = (on) => `<nav class="tabbar" aria-label="Principal">${TABS.map(([id, l, i]) => `<a href="#/${id}" class="${id === on ? "on" : ""}" ${id === on ? 'aria-current="page"' : ""}>${svg(i, 22)}<span>${l}</span></a>`).join("")}</nav>`;
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
// A Solarman só é consultada das 06:30 às 18:55 (supabase/functions/collect/time.ts): fora disso não está atrasada.
const solarPaused = (s) => { if (s.source !== "solarman") return false; const t = spNow(), m = t.hour * 60 + t.minute; return m < 6 * 60 + 45 || m >= 19 * 60; };
const solarPowerNow = (w) => solarPaused({ source: "solarman" }) ? 0 : w;
const lateMin = (s) => solarPaused(s) ? 0 : (s.age_minutes ?? 0);
// O selo de status é um botão: toca e o coletor roda na hora (ver data-refresh no final do arquivo).
const refreshBtn = (cls, text) => `<button type="button" class="pill ${cls} refresh" data-refresh aria-label="${text}. Toque para atualizar agora">${svg("refresh", 12, "currentColor", 2.4)}${text}</button>`;
const badge = (st) => {
  if (api.mode === "demo") return `<span class="pill demo">Dados de exemplo</span>`;
  if (!st) return "";
  const worst = Math.max(0, ...st.status.map(lateMin)), fail = st.status.some(s => !s.ok);
  if (fail) return refreshBtn("bad", "Falha na coleta");
  if (!st.status.length) return refreshBtn("warn", "Sem coleta ainda");
  const latest = st.status.map(s => s.started_at).filter(Boolean).sort().at(-1);
  return worst > 15 ? refreshBtn("warn", `Atrasado ${Math.round(worst)} min`) : refreshBtn("ok", `Atualizado ${latest ? hhmm(latest) : ""}`);
};
const header = (small, title, st, back, pill) => `<div class="hd"><div class="row">${back ? `<a class="back" href="#/${back}" aria-label="Voltar">${svg("left", 20)}</a>` : ""}<div class="l"><small>${small}</small><h1>${title}</h1></div></div>${pill ?? badge(st)}</div>`;
const tile = (k, v, u, s, dot) => `<div class="tile"><div class="k">${dot ? `<i style="background:${dot}"></i>` : ""}${k}</div><div class="v">${v}${u ? `<u>${u}</u>` : ""}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
// Quadro com seta no lugar do ponto: a rede tem uma cor só, o sentido vem da seta.
const tileArrow = (k, v, u, dir) => `<div class="tile"><div class="k">${svg(dir, 14, C.grid, 2.6)}${k}</div><div class="v">${v}<u>${u}</u></div></div>`;
const nowMap = (rows) => Object.fromEntries(rows.map(r => [`${r.device_id}.${r.metric}`, r]));
const val = (m, k) => m[k]?.value;
// So usa a direcao assinada quando ela pertence a mesma amostra da potencia.
// Se o coletor nao conseguiu determinar o sentido, cai no saldo horario abaixo.
const currentGridSigned = (m) => {
  const signed = m["grid_meter.power_signed_w"], power = m["grid_meter.power_w"];
  return signed?.ts === power?.ts && isNum(signed?.value) ? signed.value : null;
};
const staleNote = (m, k) => m[k]?.is_stale ? ` · dado de ${Math.round(m[k].age_minutes)} min atrás` : "";

async function safe(render, route, version) {
  try { await render(); } catch (e) {
    if (version !== busy) return;
    console.error(e);
    $app.innerHTML = `<main>${header("EnergyKontrol", "Ops")}<div class="err" role="alert">Não consegui carregar os dados.<br><small>${esc(e.message || e)}</small></div><button class="btn" id="retry">Tentar de novo</button></main>${tabbar(route)}`;
    document.getElementById("retry").onclick = () => go();
  }
}

/* ---------- INÍCIO ---------- */
// O Início vem de uma única chamada (get_home). A última resposta do dia fica guardada neste aparelho:
// a tela abre na hora com ela ("Atualizando…") e troca pelos dados novos quando chegam.
const HOME_KEY = "energykontrol-home-v1";
const readHome = (date) => { try { const c = JSON.parse(localStorage.getItem(HOME_KEY)); return c && c.date === date && c.data ? c : null; } catch { return null; } };
const saveHome = (date, data) => { try { localStorage.setItem(HOME_KEY, JSON.stringify({ date, at: Date.now(), data })); } catch {} };
// Dado guardado envelhece: soma o tempo desde que foi salvo às idades das leituras.
const ageData = ({ data, at }) => { const mins = (Date.now() - at) / 60000, bump = (r) => ({ ...r, age_minutes: (r.age_minutes ?? 0) + mins }); return { ...data, now: data.now.map(r => ({ ...bump(r), is_stale: r.is_stale || (r.age_minutes ?? 0) + mins > 15 })), status: data.status.map(bump) }; };
const REASON = (fl, P) => ({
  "aguardando-solar": `A geração está sem atualizar ${ageText(fl.gAge)}. O consumo volta com a próxima leitura.`,
  "aguardando-rede": `A leitura da rede está atrasada (${ageText(fl.gridAge)}). O consumo volta com a próxima leitura.`,
  "nao-fecham": `A geração (${P(fl.g)}) e a rede (${P(fl.grid)}) vieram de horários diferentes e não fecham. O consumo volta na próxima atualização.`
}[fl.reason] || "");
// Estado do fluxo agora (Início e Casa): geração, rede, consumo (ou o motivo de não haver) e aparelhos.
function flowOf(h) {
  const hrs = h.hourly, m = nowMap(h.now), gRow = m["solar_plant.power_w"], gridRow = m["grid_meter.power_w"], gridSigned = currentGridSigned(m);
  const grid = isNum(gridSigned) ? Math.abs(gridSigned) : gridRow?.value, ac = val(m, "appliance_ac.power_w"), bo = val(m, "appliance_boiler.power_w");
  const last = hrs.filter(x => isNum(x.consumo)).at(-1) ?? h.hourNow;
  const exporting = isNum(gridSigned) ? gridSigned < 0 : last ? (last.e ?? 0) > (last.i ?? 0) : true;
  const paused = solarPaused({ source: "solarman" });
  const fl = agoraFlow({ g: gRow?.value, gAge: gRow?.age_minutes, solarPaused: paused, grid, gridAge: gridRow?.age_minutes, exporting });
  const outros = isNum(fl.consumo) ? Math.max(fl.consumo - (ac || 0) - (bo || 0), 0) : null;
  const P = (w) => { const p = power(w); return `${p.v} ${p.u}`.trim(); };
  return { m, fl, grid, ac, bo, exporting, paused, outros, P, why: REASON(fl, P) };
}
function inicioHtml(h, { today, pill }) {
  const hrs = h.hourly, { m, fl, grid, ac, bo, exporting, paused, outros, P, why } = flowOf(h);
  const tg = sum(hrs, "g"), tc = sum(hrs, "consumo"), ti = sum(hrs, "i"), te = sum(hrs, "e");
  const su = selfUse(h.self.find(r => r.day === today.date), tg, te), est = su.estimated ? "~" : "";
  const tarifa = parseFloat(lsGet("tarifa", "0.95")) || 0, econ = isNum(su.self) ? su.self * tarifa : null;
  const hourly = (k) => Array.from({ length: 24 }, (_, i) => { const r = hrs.find(x => +x.hour_local.slice(11, 13) === i); return r ? r[k] : null; });
  const nowIdx = hrs.length ? +hrs.at(-1).hour_local.slice(11, 13) : null;
  const onTxt = (w, key) => (!isNum(w) ? "Sem dado" : w > 30 ? "Ligado" : "Desligado") + staleNote(m, key);
  const ap = (name, w, color, on) => `<div class="ap"><div class="k"><span class="dot" style="background:${color}"></span>${name}</div><div class="v">${P(w)}</div><div class="s">${on}</div></div>`;
  const age = (txt, warn) => `<span class="age${warn ? " warn" : ""}">${txt}</span>`;
  return `<main>${header("Casa de exemplo", "Agora", { status: h.status }, null, pill)}
  <section class="card big" aria-label="Fluxo de energia agora"><div class="flow">
    <div class="node"><div class="c" style="border-color:${C.amb};background:rgba(255,194,102,.12)">${svg("sun", 28, C.amb)}</div><b>${P(fl.g)}</b><span>Geração solar</span>${age(paused ? "pausa noturna" : ageText(fl.gAge), !paused && fl.gAge > 10)}</div>
    <div class="arrow ${isNum(fl.g) && fl.g > 20 ? "" : "off"}" style="color:${C.amb}"><i></i>${svg("chev", 14, C.amb, 3)}<i></i></div>
    <div class="node"><div class="c" style="border-color:${C.cy};background:rgba(95,212,240,.14)">${svg("home", 28, C.cy)}</div><b${isNum(fl.consumo) ? "" : ` class="none"`}>${isNum(fl.consumo) ? P(fl.consumo) : "—"}</b><span>Consumo da casa</span>${age(isNum(fl.consumo) ? "calculado" : why ? "aguardando" : "")}</div>
    <div class="arrow ${exporting ? "" : "rev"} ${isNum(grid) && grid > 20 ? "" : "off"}" style="color:${C.grid}"><i></i>${svg("chev", 14, C.grid, 3)}<i></i></div>
    <div class="node"><div class="c" style="border-color:${C.grid};background:rgba(123,224,160,.12)">${svg("bolt", 28, C.grid)}</div><b>${P(grid)}</b><span>${exporting ? "Injetando na rede" : "Puxando da rede"}</span>${age(ageText(fl.gridAge), fl.gridAge > 10)}</div>
  </div>${why ? `<div class="why">${svg("clock", 16, C.amb, 2)}<span>${esc(why)}</span></div>` : ""}</section>
  <section class="card"><div class="top"><h2>Geração × consumo por hora</h2><span class="unit">kWh</span></div>
    ${hourlyLines({ series: [{ values: hourly("g"), color: C.amb, area: true }, { values: hourly("consumo"), color: C.cy }], nowIdx, label: "Geração solar e consumo da casa por hora, hoje", names: ["Geração", "Consumo"], unit: "kWh" })}
    <div class="legend"><span><i style="background:${C.amb}"></i>Geração</span><span><i style="background:${C.cy}"></i>Consumo</span><span class="mut">Hora atual tracejada</span></div></section>
  <div class="sect"><b>Hoje</b><span>Autoconsumo <em>${isNum(su.pct) ? est + pct(su.pct) : "—"}</em></span></div>
  <div class="tiles t2">${tile("Geração", kwh(tg), "kWh", "", C.amb)}${tile("Consumo", kwh(tc), "kWh", "", C.cy)}${tileArrow("Da rede", kwh(ti), "kWh", "down")}${tileArrow("Para a rede", kwh(te), "kWh", "up")}</div>
  ${isNum(econ) ? `<div class="line">Economia estimada hoje <b>${brl(econ)}</b> · tarifa ${brl(tarifa)}/kWh</div>` : ""}
  <div class="foot note">Autoconsumo é a parte da geração usada em casa. O que vai e vem da rede segue a medição da Neoenergia.${su.estimated ? " ~ = estimado (dados do dia incompletos)." : ""}</div>
  <a class="card link" href="#/aparelhos" style="display:block"><div class="top" style="margin-bottom:12px"><h2>Aparelhos agora</h2><span class="more">Detalhes${svg("chev", 14, "currentColor", 2.4)}</span></div>
    <div class="tiles t3" style="gap:10px">${ap("Ar-cond.", ac, C.vio, onTxt(ac, "appliance_ac.power_w"))}${ap("Boiler", bo, C.pink, onTxt(bo, "appliance_boiler.power_w"))}${ap("Outros", outros, C.sl, "Resto da casa")}</div></a>
  ${quickHtml({ carToday: h.car, pool: h.pool, today: today.date })}
  ${api.mode === "demo" ? askCard : ""}
  </main>${tabbar("inicio")}`;
}
// Atalho para a tela do assistente (respostas gravadas da avaliação; ver assistente.js).
const askCard = `<a class="card link" href="#/assistente" style="display:block"><div class="top" style="margin-bottom:6px"><h2>${svg("chat", 18, C.ui, 2)} Pergunte ao assistente</h2><span class="more">Abrir${svg("chev", 14, "currentColor", 2.4)}</span></div><div class="foot note">Respostas de exemplo do assistente de IA (LangChain.js + Gemini + RAG), com o expert e as ferramentas que ele usou.</div></a>`;
// Carrega o Início (get_home) com a regra "abre com o que está guardado, atualiza em seguida".
async function withHome(version, render, after) {
  const today = spNow(), live = api.mode === "live", cached = live ? readHome(today.date) : null;
  if (cached) {
    $app.innerHTML = render(ageData(cached), { today, pill: `<span class="pill neutral" role="status">Atualizando…</span>` });
    $app.querySelectorAll("[aria-label='Registros rápidos'] button").forEach(b => { b.disabled = true; });
    bindCharts($app);
  }
  let h;
  try { h = await api.fetchHome(today.date); } catch (e) {
    if (!cached || version !== busy) throw e;
    $app.innerHTML = render(ageData(cached), { today, pill: `<span class="pill warn" role="status">Sem conexão · dados das ${hhmm(new Date(cached.at).toISOString())}</span>` });
    return;
  }
  if (live) saveHome(today.date, h);
  if (version !== busy) return;
  $app.innerHTML = render(h, { today });
  after?.(h, today);
}
const viewInicio = (version) => withHome(version, inicioHtml, (h, today) => bindQuick({ root: $app, api, go: () => go(), today: today.date, pool: h.pool }));

/* ---------- HISTÓRICO ---------- */
function range(tab, a) {
  const [y, mo] = [+a.slice(0, 4), +a.slice(5, 7) - 1];
  if (tab === "dia") return { from: a, to: a, label: a === spNow().date ? "Hoje" : fmtDate(a), step: (d) => addDays(a, d) };
  if (tab === "semana") { const f = addDays(a, -6); return { from: f, to: a, label: `${dnum(f)} a ${fmtDate(a)}`, step: (d) => addDays(a, 7 * d) }; }
  if (tab === "mes") { const f = `${y}-${String(mo + 1).padStart(2, "0")}-01`, last = new Date(Date.UTC(y, mo + 1, 0)).toISOString().slice(0, 10); return { from: f, to: last, label: `${mesNome(mo)[0].toUpperCase()}${mesNome(mo).slice(1)} de ${y}`, step: (d) => { const t = new Date(Date.UTC(y, mo + d, 1)); return t.toISOString().slice(0, 10); } }; }
  return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y), step: (d) => `${y + d}-01-01` };
}
async function viewHistorico(version) {
  const t = spNow(); if (!state.anchor) state.anchor = t.date;
  const { tab } = state, R = range(tab, state.anchor);
  const eventsP = Promise.all([api.fetchEvents(R.from, R.to), api.fetchOpenPool(), api.fetchPoolPeriods(R.from, R.to)])
    .catch(e => { console.warn("eventos indisponíveis", e); return [[], null, []]; });
  const rowsP = tab === "dia" ? api.fetchHourly(R.from) : api.fetchDaily(R.from, R.to);
  const baseP = tab === "ano" ? Promise.resolve([]) : api.fetchDaily(addDays(R.from, -14), R.to)
    .catch(e => { console.warn("anomalias indisponíveis", e); return []; });
  const [first, [evs, pool, periods], periodRows, base] = await Promise.all([
    api.fetchNow().catch(() => null), eventsP, rowsP, baseP
  ]);
  const carSet = new Set(evs.filter(e => e.kind === "carro").map(e => localDate(e.started_at)));
  const poolOn = (d) => periods.some(p => localDate(p.started_at) <= d && (p.ended_at ? localDate(p.ended_at) >= d : d <= t.date));
  const flags = (d) => ({ car: carSet.has(d), pool: poolOn(d), tag: [carSet.has(d) ? "recarga do carro" : "", poolOn(d) ? "bomba ligada" : ""].filter(Boolean).join(" · ") });
  let cats, rows, hours = null;
  if (tab === "dia") {
    hours = periodRows;
    cats = Array.from({ length: 24 }, (_, i) => { const r = hours.find(x => +x.hour_local.slice(11, 13) === i); return { label: i % 3 === 0 ? `${i}h` : "", ro: `${i}h–${i + 1}h`, values: [r?.g ?? null, r?.consumo ?? null] }; });
    rows = hours;
  } else {
    const daily = periodRows; rows = daily;
    if (tab === "semana") cats = Array.from({ length: 7 }, (_, k) => { const d = addDays(R.from, k), r = daily.find(x => x.day === d); return { label: dow(d), sub: String(dnum(d)), ro: `${dow(d)} ${dnum(d)}`, ...flags(d), bold: d === t.date, values: [r?.g ?? null, r?.consumo ?? null] }; });
    else if (tab === "mes") { const nd = daysBetween(R.from, R.to) + 1; cats = Array.from({ length: nd }, (_, k) => { const d = addDays(R.from, k), r = daily.find(x => x.day === d); return { label: String(k + 1), ro: `Dia ${k + 1}`, ...flags(d), values: [r?.g ?? null, r?.consumo ?? null] }; }); }
    else cats = Array.from({ length: 12 }, (_, mo) => { const rs = daily.filter(x => +x.day.slice(5, 7) - 1 === mo); const nc = [...carSet].filter(d => +d.slice(5, 7) - 1 === mo).length; return { label: mesCurto(mo), ro: mesNome(mo), car: nc > 0, tag: nc ? `${nc} ${nc === 1 ? "recarga" : "recargas"} do carro` : "", values: [sum(rs, "g"), sum(rs, "consumo")] }; });
  }
  const tot = (k) => sum(rows, k), c = tot("consumo");
  const eq = [["Ar-condicionado", tot("ac"), C.vio], ["Boiler", tot("bo"), C.pink], ["Outros", tot("outros"), C.sl]];
  const eqSum = eq.reduce((a, x) => a + (x[1] || 0), 0) || 1;
  const decimals = tab === "dia" ? 2 : tab === "ano" ? 0 : 1;
  const hasGenerationWithoutConsumption = rows.some(r => isNum(r.g) && !isNum(r.consumo));
  const canNext = R.step(1) <= (tab === "ano" ? t.date : tab === "mes" ? t.date.slice(0, 8) + "01" : t.date) || (tab === "mes" && R.step(1).slice(0, 7) <= t.date.slice(0, 7)) || (tab === "ano" && +R.step(1).slice(0, 4) <= +t.date.slice(0, 4));
  const unit = tab === "dia" ? "kWh/h" : "kWh";
  const anoms = tab === "ano" ? [] : anomalies(base, R.from, R.to);
  const dayBan = tab === "dia" ? [carSet.has(R.from) ? ["#5FD4F0", "Recarga do carro registrada neste dia"] : null, poolOn(R.from) ? ["#A78BFA", "Bomba da piscina ligada neste dia"] : null].filter(Boolean) : [];
  const anyFlag = ["semana", "mes", "ano"].includes(tab) ? cats.some(c => c.car || c.pool) : false;
  const legendX = `${dayBan.map(([c, t2]) => `<div class="foot" style="text-align:left;padding:0 2px 8px;display:flex;align-items:center;gap:8px;color:var(--tx)"><i class="dot" style="background:${c}"></i>${t2}</div>`).join("")}${anyFlag ? `<div class="legend" style="margin-top:6px"><span><i style="background:rgba(167,139,250,.35)"></i>Bomba da piscina ligada</span><span>${carIcon(12)}&nbsp;Recarga do carro</span></div>` : ""}`;
  const evHtml = eventsHtml({ events: evs, anoms, form: state.evForm, today: t.date, carDays: evs.filter(e => e.kind === "carro").map(e => localDate(e.started_at)), pool });
  if (version !== busy) return;
  $app.innerHTML = `<main>${header("Casa de exemplo", "Histórico", first)}
  <div class="seg" role="tablist">${[["dia", "Dia"], ["semana", "Semana"], ["mes", "Mês"], ["ano", "Ano"]].map(([id, l]) => `<button role="tab" data-tab="${id}" class="${id === tab ? "on" : ""}" aria-selected="${id === tab}">${l}</button>`).join("")}</div>
  <div class="nav"><button id="prev" aria-label="Anterior">${svg("left", 18)}</button><span>${R.label}</span><button id="next" aria-label="Próximo" ${canNext ? "" : "disabled"}>${svg("chev", 18)}</button></div>
  <section class="card"><div class="top"><h2>Geração × consumo ${tab === "dia" ? "por hora" : tab === "ano" ? "por mês" : "por dia"}</h2><span class="unit">${unit}</span></div>
    ${groupedBars({ cats, colors: [C.amb, C.cy], label: "Geração e consumo no período", names: ["Geração", "Consumo"], unit })}
    <div class="legend"><span><i style="background:${C.amb}"></i>Geração</span><span><i style="background:${C.cy}"></i>Consumo</span></div>${legendX}</section>
  <div class="tiles t2">${tile("Geração", kwhPrecise(tot("g"), decimals), "kWh", "", C.amb)}${tile("Consumo", kwhPrecise(c, decimals), "kWh", "", C.cy)}${tileArrow("Da rede", kwhPrecise(tot("i"), decimals), "kWh", "down")}${tileArrow("Para a rede", kwhPrecise(tot("e"), decimals), "kWh", "up")}</div>
  ${hasGenerationWithoutConsumption ? `<div class="notice">O histórico de geração começa antes da medição da rede. Onde não há dados da rede, o consumo da casa fica indisponível.</div>` : ""}
  <section class="card"><div class="top"><h2>Consumo por equipamento</h2><span class="unit">${{ dia: "dia", semana: "semana", mes: "mês", ano: "ano" }[tab]}</span></div>
    <div class="stackbar">${eq.map(([, v, col]) => `<span style="flex:${Math.max(v || 0, 0.001)};background:${col}"></span>`).join("")}</div>
    <div class="list">${eq.map(([n, v, col]) => `<div><span><i class="dot" style="background:${col}"></i>${n}</span><span class="r">${kwhPrecise(v, decimals)} kWh <small>· ${isNum(v) ? Math.round(v / eqSum * 100) : 0}%</small></span></div>`).join("")}</div></section>
  ${evHtml}
  </main>${tabbar("historico")}`;
  bindEvents({ root: $app, api, state, go: () => go() });
  $app.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => {
    if (b.dataset.tab === state.tab) return;
    state.tab = b.dataset.tab; state.anchor = spNow().date;
    const seg = b.closest(".seg");
    seg.classList.add("loading"); seg.setAttribute("aria-busy", "true");
    seg.querySelectorAll("button").forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-selected", String(on)); x.disabled = true; });
    go();
  });
  document.getElementById("prev").onclick = () => { state.anchor = R.step(-1); go(); };
  document.getElementById("next").onclick = () => { let nx = R.step(1); if (nx > spNow().date) nx = spNow().date; state.anchor = nx; go(); };
}

/* ---------- CRÉDITOS ---------- */
async function viewCreditos(version) {
  const t = spNow(), [n, cr, bills] = await Promise.all([api.fetchNow().catch(() => null), api.fetchCredits(), api.fetchBills().catch(() => [])]);
  if (version !== busy) return;
  const months = creditMonths(bills), cons = creditsHtml(months, balanceChecks(months));
  if (!cr) {
    $app.innerHTML = `<main>${header("Casa de exemplo", "Créditos", n)}${cons}<div class="card"><h2>Informe o saldo da sua conta de luz</h2><p style="color:var(--mut);font-size:13px;line-height:1.5">O app precisa de um ponto de partida: o saldo de créditos impresso na última conta da Neoenergia. A partir dele, soma o que você injeta e subtrai o que puxa da rede.</p>${baselineForm(t.date)}</div></main>${tabbar("creditos")}`;
    return bindBaseline();
  }
  const daily = await api.fetchDaily(addDays(cr.as_of, 1), t.date);
  // O mínimo faturado (min_billed_kwh por ciclo) não sai dos créditos: a curva gasta essa franquia primeiro.
  const covered = isNum(cr.compensated_kwh) ? cr.imported_kwh - cr.compensated_kwh : 0;
  let bal = cr.base_kwh, free = covered; const pts = [bal]; for (const d of daily) { const i = d.i ?? 0, f = Math.min(i, free); free -= f; bal += (d.e ?? 0) - (i - f); pts.push(bal); }
  const net = cr.balance_kwh - cr.base_kwh;
  const dl = cr.days_left;
  $app.innerHTML = `<main>${header("Casa de exemplo", "Créditos", n)}${cons}
  <section class="card big"><div style="font-size:14px;color:var(--mut)">Saldo estimado em ${fmtDate(t.date)}</div>
    <div class="big-n" style="margin:6px 0 6px">${kwh(cr.balance_kwh, 2)}<u>kWh</u></div>
    ${sparkline({ values: pts, color: C.ui, labels: [fmtDate(cr.as_of), fmtDate(t.date)] })}</section>
  <section class="card"><div class="list">
    <div><span style="color:var(--mut)">Saldo na conta de ${esc(cr.as_of.slice(8, 10))}/${esc(cr.as_of.slice(5, 7))}</span><span class="r">${kwh(cr.base_kwh, 2)} kWh</span></div>
    <div><span>${svg("up", 14, C.grid, 2.6)} Para a rede</span><span class="r" style="color:var(--grid)">+ ${kwh(cr.exported_kwh, 0)} kWh</span></div>
    <div><span>${svg("down", 14, C.grid, 2.6)} Da rede</span><span class="r">− ${kwh(cr.imported_kwh, 0)} kWh</span></div>
    ${covered > 0 ? `<div><span style="color:var(--mut)">Coberto pelo mínimo de ${kwh(cr.min_billed_kwh, 0)} kWh</span><span class="r">+ ${kwh(covered, 0)} kWh</span></div>` : ""}
    <div><b>Saldo estimado</b><span class="r">${kwh(cr.balance_kwh, 2)} kWh</span></div></div></section>
  <div class="tiles" style="grid-template-columns:1fr 1fr">${tile("Desde a conta", (net >= 0 ? "+" : "−") + kwh(Math.abs(net), 0), "kWh", net >= 0 ? "Saldo subindo" : "Saldo caindo")}${durationTile(dl)}</div>
  <section class="card"><button class="btn ghost" id="openBase" style="width:100%">Atualizar com a conta de luz</button><div id="baseBox" hidden style="margin-top:12px">${baselineForm(t.date)}</div></section>
  <a class="card link" href="#/contas" ><span class="rowtxt"><b>Contas de luz</b><small>Enviar conta e ver o relatório</small></span>${svg("chev", 18, "var(--mut)")}</a>
  <div class="foot">Estimativa a partir do seu medidor. O saldo oficial é o da conta da Neoenergia.</div>
  </main>${tabbar("creditos")}`;
  document.getElementById("openBase").onclick = () => { document.getElementById("baseBox").hidden = false; document.getElementById("openBase").hidden = true; };
  bindBaseline();
}
// Duração do saldo só faz sentido quando ele está caindo: saldo crescendo e prazos de anos viram texto.
const durationTile = (dl) => isNum(dl) && dl <= 730
  ? tile("Duração do saldo", kwh(dl, 0), "dias", "No ritmo dos últimos dias")
  : `<div class="tile"><div class="k">Duração do saldo</div><div class="v txt">${isNum(dl) ? "Mais de 2 anos" : "Não está diminuindo"}</div><div class="s">No ritmo dos últimos dias</div></div>`;
const baselineForm = (d) => `<form class="form" id="baseForm"><label>Data de referência da conta<input type="date" name="as_of" value="${d}" required></label><label>Saldo de créditos (kWh)<input type="text" inputmode="decimal" name="bal" placeholder="Ex.: 2038,67" required></label><button class="btn" type="submit">Salvar saldo</button><div id="baseMsg" class="foot" role="status"></div></form>`;
function bindBaseline() {
  const f = document.getElementById("baseForm"); if (!f) return;
  f.onsubmit = async (e) => {
    e.preventDefault(); const msg = document.getElementById("baseMsg"), v = parseFloat(String(f.bal.value).replace(/\./g, "").replace(",", "."));
    if (!isFinite(v)) { msg.textContent = "Saldo inválido."; return; }
    try { msg.textContent = "Salvando…"; await api.saveBaseline(f.as_of.value, v); go(); } catch (err) { msg.textContent = err.message; }
  };
}

/* ---------- APARELHOS ---------- */
async function viewAparelhos(version) {
  const t = spNow(), [n, hrs, boil] = await Promise.all([api.fetchNow(), api.fetchHourly(t.date), api.fetchBoiler(t.date, t.date)]);
  const m = nowMap(n.now), ac = val(m, "appliance_ac.power_w"), bo = val(m, "appliance_boiler.power_w"), g = solarPowerNow(val(m, "solar_plant.power_w")), gridSigned = currentGridSigned(m), gridLegacy = val(m, "grid_meter.power_w"), grid = isNum(gridSigned) ? Math.abs(gridSigned) : gridLegacy;
  const tc = sum(hrs, "consumo"), tac = sum(hrs, "ac"), tbo = sum(hrs, "bo"), tot = sum(hrs, "outros");
  const last = hrs.filter(h => isNum(h.consumo)).at(-1), exporting = isNum(gridSigned) ? gridSigned < 0 : last ? (last.e ?? 0) > (last.i ?? 0) : true;
  const cons = isNum(g) && isNum(grid) ? Math.max(g + (exporting ? -grid : grid), 0) : null, outW = isNum(cons) ? Math.max(cons - (ac || 0) - (bo || 0), 0) : null;
  const share = (v) => isNum(v) && tc > 0 ? Math.round(v / tc * 100) : 0, P = (w) => { const p = power(w); return `${p.v} ${p.u}`.trim(); };
  const st = (w, key) => (!isNum(w) ? "Sem dado" : w > 30 ? `Ligado · ${P(w)}` : "Desligado") + staleNote(m, key);
  const hourly = (k) => Array.from({ length: 24 }, (_, i) => { const r = hrs.find(x => +x.hour_local.slice(11, 13) === i); return r ? r[k] : null; });
  const nowIdx = hrs.length ? +hrs.at(-1).hour_local.slice(11, 13) : null, b = boil[0];
  let call = "";
  if (b && b.boiler_kwh_total > 0.05) {
    const off = b.boiler_kwh_off_sun, p = Math.round(off / b.boiler_kwh_total * 100);
    call = `<div class="callout"><span>${svg("flame", 22, C.pink)}</span><div><b>${p >= 50 ? "Boiler ligou fora do sol" : "Boiler aproveitou o sol"}</b>Hoje ele usou ${kwh(b.boiler_kwh_total, 1)} kWh, e ${kwh(off, 1)} kWh (${p}%) foram nas horas de pouco sol, quando a energia vem da rede ou dos seus créditos.${p >= 50 ? " Ligado entre 11h e 15h, usaria a geração solar." : ""}</div></div>`;
  }
  if (version !== busy) return;
  $app.innerHTML = `<main>${header("Hoje, até agora", "Aparelhos", n, "inicio")}
  <div class="tiles t3">${tile("Ar-cond.", kwhPrecise(tac, 1), "kWh", `${share(tac)}% do consumo<br><b style="color:var(--tx)">${st(ac, "appliance_ac.power_w")}</b>`, C.vio)}${tile("Boiler", kwhPrecise(tbo, 1), "kWh", `${share(tbo)}% do consumo<br><b style="color:var(--tx)">${st(bo, "appliance_boiler.power_w")}</b>`, C.pink)}${tile("Outros", kwhPrecise(tot, 1), "kWh", `${share(tot)}% do consumo<br><b style="color:var(--tx)">${P(outW)} agora</b>`, C.sl)}</div>
  <section class="card"><div class="top"><h2>Consumo por hora</h2><span class="unit">kWh</span></div>
    ${stackedHourly({ stacks: [{ values: hourly("outros"), color: C.sl }, { values: hourly("ac"), color: C.vio }, { values: hourly("bo"), color: C.pink }], nowIdx, label: "Consumo por hora, por equipamento", names: ["Outros", "Ar-cond.", "Boiler"], unit: "kWh" })}
    <div class="legend"><span><i style="background:${C.vio}"></i>Ar-condicionado</span><span><i style="background:${C.pink}"></i>Boiler</span><span><i style="background:${C.sl}"></i>Outros</span></div></section>
  ${call}</main>${tabbar("inicio")}`;
}

/* ---------- AJUSTES ---------- */
const SRC = { solarman: ["SOLARMAN Smart", "Microinversores Deye"], tuya: ["Tuya", "Medidor da rede e aparelhos"] };
async function viewAjustes(version) {
  const [n, audits] = await Promise.all([api.fetchNow().catch(() => null), api.mode === "live" ? api.fetchGridAudits().catch(() => []) : Promise.resolve([])]), tarifa = lsGet("tarifa", "0.95");
  const rows = (n?.status || []).map(s => { const [nm, sub] = SRC[s.source] || [s.source, "Coletor"], fail = !s.ok, late = lateMin(s) > 15, paused = solarPaused(s); return `<div class="conn"><div><b>${esc(nm)}</b><small>${esc(sub)} · há ${Math.round(s.age_minutes ?? 0)} min</small></div><span class="st ${fail ? "bad" : late ? "warn" : "ok"}">${fail ? "Falha" : late ? "Atrasado" : paused ? "Pausa noturna" : "Conectado"}</span></div>`; }).join("");
  const N = (v) => isNum(v) ? kwhPrecise(v, 2) : "—", PCT = (v) => isNum(v) ? `${Math.round(v * 100)}%` : "—";
  const auditRows = audits.map(a => `<section class="card"><div class="top"><div><b>${new Date(a.measured_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}</b><div class="foot" style="text-align:left">${a.previous_at ? `Desde ${new Date(a.previous_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", timeStyle: "short" })} · cobertura ${PCT(a.coverage)}` : "Marco inicial"}</div></div><button class="btn ghost" data-audit-del="${a.id}" style="min-height:36px;padding:6px 10px">Excluir</button></div>${a.previous_at ? `<div class="list"><div><span>Neoenergia</span><b>↓ ${N(a.neo_import_kwh)} · ↑ ${N(a.neo_export_kwh)} kWh</b></div><div><span>Tuya bruto</span><b>↓ ${N(a.tuya_import_kwh)} · ↑ ${N(a.tuya_export_kwh)} kWh</b></div><div><span>EnergyKontrol líquido</span><b>↓ ${N(a.net_import_kwh)} · ↑ ${N(a.net_export_kwh)} kWh</b></div></div>` : ""}</section>`).join("");
  const localNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  if (version !== busy) return;
  $app.innerHTML = `<main>${header("Casa de exemplo", "Ajustes", n)}
  <div class="cap">CONEXÕES</div><section class="card">${rows || `<div class="empty">${api.mode === "demo" ? "Modo demonstração: sem conexões reais." : "Nenhuma coleta registrada ainda."}</div>`}</section>
  <div class="cap">ENERGIA</div><section class="card"><form class="form" id="tarForm"><label>Tarifa (R$ por kWh, para estimar economia)<input name="t" inputmode="decimal" value="${esc(String(tarifa).replace(".", ","))}"></label><button class="btn ghost" type="submit">Salvar tarifa</button><div class="foot" id="tarMsg" role="status">A tarifa fica salva só neste aparelho.</div></form>
    <div class="conn"><div><b>Atualização dos dados</b><small>Os medidores enviam a cada 5 minutos</small></div><b>5 min</b></div></section>
  <div class="cap">ASSISTENTE DE IA</div><a class="card link" href="#/assistente" style="display:block"><div class="conn"><div><b>Respostas de exemplo</b><small>Perguntas da avaliação, com expert e ferramentas</small></div><span class="more">Abrir${svg("chev", 14, "currentColor", 2.4)}</span></div></a>
  ${api.mode === "live" ? `<div class="cap">AUDITORIA NEOENERGIA</div><section class="card"><p style="color:var(--mut);font-size:13px;line-height:1.5;margin-top:0">Registre os mostradores 03 e 103 no mesmo momento. A comparação líquida é experimental e não altera a tela inicial.</p><form class="form" id="auditForm"><label>Data e hora<input type="datetime-local" name="measured_at" value="${localNow}" required></label><label>03 – importado (kWh, sem separador)<input name="imp" inputmode="numeric" placeholder="Ex.: 15200" required></label><label>103 – injetado (kWh, sem separador)<input name="exp" inputmode="numeric" placeholder="Ex.: 14007" required></label><label>24 (opcional, sem separador)<input name="r24" inputmode="numeric" placeholder="Ex.: 1731"></label><label>Observação (opcional)<input name="note" maxlength="200"></label><button class="btn ghost" type="submit">Salvar marco</button><div class="foot" id="auditMsg" role="status"></div></form></section>${auditRows || `<div class="empty">Salve o primeiro marco para iniciar a comparação.</div>`}` : ""}
  ${api.mode === "live" ? `<button class="btn ghost" id="out">Sair da conta</button>` : ""}
  <div class="foot">EnergyKontrol · Sua energia sob controle.<br>Versão ${esc(self.APP_VERSION ?? "—")}${self.APP_DATE ? ` · ${self.APP_DATE.split("-").reverse().join("/")}` : ""}<br>${api.mode === "demo" ? "Modo demonstração (dados de exemplo)" : "Conectado ao seu banco"} · As chaves dos medidores ficam só no servidor.</div></main>${tabbar("ajustes")}`;
  document.getElementById("tarForm").onsubmit = (e) => { e.preventDefault(); const v = parseFloat(String(e.target.t.value).replace(",", ".")); if (isFinite(v) && v > 0) { lsSet("tarifa", String(v)); document.getElementById("tarMsg").textContent = "Tarifa salva."; } else document.getElementById("tarMsg").textContent = "Valor inválido."; };
  const af = document.getElementById("auditForm"); if (af) af.onsubmit = async (e) => { e.preventDefault(); const f = e.target, num = (v) => Number(String(v).trim().replace(/\./g, "").replace(",", ".")), imp = num(f.imp.value), exp = num(f.exp.value), r24 = f.r24.value.trim() ? num(f.r24.value) : null, msg = document.getElementById("auditMsg"); if (![imp, exp].every(v => isFinite(v) && v >= 0) || (r24 !== null && (!isFinite(r24) || r24 < 0))) { msg.textContent = "Confira os valores informados."; return; } const b = f.querySelector("button"); b.disabled = true; try { await api.saveGridAudit({ measured_at: new Date(`${f.measured_at.value}:00-03:00`).toISOString(), register_import_kwh: imp, register_export_kwh: exp, register_24: r24, note: f.note.value.trim() || null }); go(); } catch (err) { msg.textContent = /duplicate|unique/i.test(err.message) ? "Já existe um marco nesse horário." : err.message; b.disabled = false; } };
  document.querySelectorAll("[data-audit-del]").forEach(b => b.onclick = async () => { b.disabled = true; try { await api.deleteGridAudit(b.dataset.auditDel); go(); } catch { b.disabled = false; } });
  const o = document.getElementById("out"); if (o) o.onclick = async () => { await api.signOut(); go(); };
}

/* ---------- LOGIN + ROTAS ---------- */
function viewLogin(msg = "") {
  $app.innerHTML = `<main class="login"><div><h1>EnergyKontrol</h1><p>Sua energia sob controle.</p></div>
  <form class="form" id="lf"><label>E-mail<input type="email" name="e" autocomplete="username" required></label><label>Senha<input type="password" name="p" autocomplete="current-password" required></label><button class="btn" type="submit">Entrar</button><div class="err" role="alert" ${msg ? "" : "hidden"} id="lm">${esc(msg)}</div></form></main>`;
  document.getElementById("lf").onsubmit = async (e) => {
    e.preventDefault(); const b = e.target.querySelector("button"); b.disabled = true;
    try { await api.signIn(e.target.e.value.trim(), e.target.p.value); go(); } catch (err) { const m = document.getElementById("lm"); m.hidden = false; m.textContent = /invalid/i.test(err.message) ? "E-mail ou senha incorretos." : err.message; b.disabled = false; }
  };
}
const contasViews = makeContas({ get api() { return api; }, header, tabbar, svg, $app, go: () => go(), state });
const houseHtml = makeHouseHtml({ header, tabbar, svg, flowOf, C });
const viewCasa = (version) => withHome(version, houseHtml);
const viewAssistente = makeAssistente({ header, tabbar, $app, state });
const VIEWS = { assistente: viewAssistente, inicio: viewInicio, casa: viewCasa, historico: viewHistorico, creditos: viewCreditos, ajustes: viewAjustes, aparelhos: viewAparelhos, ...contasViews };
const TABOF = { assistente: "inicio", aparelhos: "inicio", contas: "creditos", conta: "creditos", relatorio: "creditos" };
let busy = 0;
async function go() {
  const route = (location.hash.replace(/^#\//, "") || "inicio").split("?")[0], r = VIEWS[route] ? route : "inicio", my = ++busy;
  if (LIVE && api.mode === "live" && !(await api.session())) return viewLogin();
  const y = window.scrollY;
  if (!$app.firstElementChild || $app.dataset.r !== r) { $app.innerHTML = `<main><div class="skel" style="height:60px"></div><div class="skel"></div><div class="skel"></div></main>${tabbar(TABOF[r] || r)}`; window.scrollTo(0, 0); }
  $app.dataset.r = r;
  await safe(() => VIEWS[r](my), TABOF[r] || r, my);
  if (my !== busy) return;
  if (my === busy) bindCharts($app);
  if (my === busy && $app.dataset.r === r) window.scrollTo(0, y);
}
window.addEventListener("hashchange", () => { if (location.hash !== "#/historico") { state.tab = "dia"; state.anchor = null; } if (location.hash !== "#/historico") state.evForm = null; if (!/^#\/conta/.test(location.hash)) { state.draft = null; state.manual = false; state.edit = false; } go(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) go(); });
setInterval(() => { if (!document.hidden && !document.querySelector("form input:focus")) go(); }, 5 * 60 * 1000);

/* ---------- ATUALIZAR AGORA ---------- */
// Pede ao banco para rodar o coletor, espera a rodada aparecer em v_collector_status e redesenha a tela.
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const lastRun = (st) => Math.max(0, ...(st?.status || []).map(s => Date.parse(s.started_at) || 0));
let refreshing = false;
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-refresh]");
  if (!b || refreshing) return;
  refreshing = true; b.disabled = true; b.textContent = "Atualizando…";
  try {
    if (api.mode === "live") {
      const before = lastRun(await api.fetchNow()), r = await api.requestCollect();
      if (!r?.started) { b.textContent = `Aguarde ${r?.wait_s ?? 30} s`; await wait(2000); }
      else for (let i = 0; i < 15; i++) { await wait(3000); if (lastRun(await api.fetchNow()) > before) { await wait(1000); break; } }
    }
  } catch (err) { console.error(err); b.textContent = "Não consegui atualizar"; await wait(2500); }
  refreshing = false; go();
});

(async function boot() {
  if (LIVE) { try { const { connect } = await import("./supa.js"); api = await connect(cfg); } catch (e) { $app.innerHTML = `<main><div class="err">Não consegui conectar ao banco: ${esc(e.message)}</div></main>`; return; } }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  go();
})();
