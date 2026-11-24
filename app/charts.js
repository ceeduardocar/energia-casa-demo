import { esc, isNum } from "./util.js";
const GRID = "rgba(255,255,255,0.07)", AXIS = "rgba(255,255,255,0.16)";
const nice = (m) => { if (!(m > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(m))), f = m / p; return (f <= 1 ? 1 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 3 ? 3 : f <= 4 ? 4 : f <= 5 ? 5 : f <= 6 ? 6 : f <= 8 ? 8 : 10) * p; };
const W = 310, H = 100;
const fmtV = (v, max, dec) => (+v).toLocaleString("pt-BR", { maximumFractionDigits: dec != null ? dec : max < 5 ? 1 : 0, minimumFractionDigits: 0 });
const grid = (pad) => `<line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="${AXIS}"/><line x1="0" y1="${(H - (H - pad) / 2).toFixed(1)}" x2="${W}" y2="${(H - (H - pad) / 2).toFixed(1)}" stroke="${GRID}"/><line x1="0" y1="${pad}" x2="${W}" y2="${pad}" stroke="${GRID}"/>`;
// Envolve o SVG com eixo Y (valores), marcador e leitura dos valores ao tocar/arrastar.
function frame({ svg, hpx, max, pad, axis, data }) {
  const top = (v) => ((H - (H - pad) * v) / H * hpx).toFixed(1);
  const ticks = [[1, max], [0.5, max / 2], [0, 0]].map(([f, v]) => `<span style="top:${top(f)}px">${fmtV(v, max)}</span>`).join("");
  return `<div class="ch" data-ch="${esc(JSON.stringify(data))}"><div class="ro" aria-live="polite"></div><div class="chb"><div class="yax" style="height:${hpx}px">${ticks}</div><div class="plot">${svg}<i class="mk"></i>${axis}</div></div></div>`;
}
export const carIcon = (s = 14) => `<svg class="car-i" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="#5FD4F0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="recarga do carro"><path d="M5 17h14M3 13l2-6h14l2 6v4H3zM7 17v2M17 17v2"/></svg>`;
export function bindCharts(root) {
  root.querySelectorAll(".ch").forEach(el => {
    const d = JSON.parse(el.dataset.ch), hh = el.querySelector(".yax").style.height; el.style.setProperty("--hh", hh); const plot = el.querySelector(".plot"), mk = el.querySelector(".mk"), ro = el.querySelector(".ro"), n = d.n.length;
    const show = (i) => {
      i = Math.max(0, Math.min(n - 1, i)); mk.style.display = "block"; mk.style.left = ((i + 0.5) / n * 100) + "%";
      const parts = d.s.map(s => isNum(s.v[i]) ? `<span><i class="dot" style="background:${s.c}"></i>${esc(s.name)} <b>${fmtV(s.v[i], 0, d.dec)}</b></span>` : "").join("");
      const tot = d.total && d.s.some(s => isNum(s.v[i])) ? `<span>Total <b>${fmtV(d.s.reduce((a, s) => a + (isNum(s.v[i]) ? s.v[i] : 0), 0), 0, d.dec)}</b></span>` : "";
      ro.innerHTML = `<b class="rl">${esc(d.n[i])}</b>${parts || "<span>sem dado</span>"}${tot}<small>${esc(d.u)}</small>`;
    };
    const at = (e) => { const r = plot.getBoundingClientRect(); show(Math.floor((e.clientX - r.left) / r.width * n)); };
    plot.addEventListener("pointerdown", at); plot.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "touch") at(e); });
    show(d.def != null ? d.def : n - 1);
  });
}

// Linhas + area por hora (0..24h). series: [{values:[24], color, area}] ; nowIdx marca a hora atual
export function hourlyLines({ series, nowIdx, label, names = [], unit = "kWh" }) {
  const max = nice(Math.max(0.1, ...series.flatMap(s => s.values.filter(isNum))));
  const x = i => (i + 0.5) / 24 * W, y = v => H - (v / max) * (H - 10);
  let g = grid(10);
  for (const s of series) {
    const pts = s.values.map((v, i) => isNum(v) ? [x(i), y(v)] : null).filter(Boolean);
    if (!pts.length) continue;
    const line = pts.map(p => p.map(n => n.toFixed(1)).join(",")).join(" ");
    if (s.area) g += `<polygon points="${pts[0][0].toFixed(1)},${H} ${line} ${pts.at(-1)[0].toFixed(1)},${H}" fill="${s.color}" fill-opacity="0.2"/>`;
    g += `<polyline points="${line}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  }
  if (nowIdx != null) g += `<line x1="${x(nowIdx).toFixed(1)}" y1="0" x2="${x(nowIdx).toFixed(1)}" y2="${H}" stroke="rgba(255,255,255,0.5)" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`;
  const svg = `<svg width="100%" height="84" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${g}</svg>`;
  const axis = `<div class="axis"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>`;
  return frame({ svg, hpx: 84, max, pad: 10, axis, data: { n: Array.from({ length: 24 }, (_, i) => `${i}h–${i + 1}h`), u: unit, dec: 2, def: nowIdx, s: series.map((s, k) => ({ name: names[k] || "", c: s.color, v: s.values.map(v => isNum(v) ? Math.round(v * 100) / 100 : null) })) } });
}

// Barras agrupadas. cats:[{label, sub, values:[v1,v2], bold}] ; colors
export function groupedBars({ cats, colors, label, height = 140, names = [], unit = "kWh" }) {
  const max = nice(Math.max(0.1, ...cats.flatMap(c => c.values.filter(isNum))));
  const n = cats.length, slot = W / n, bw = Math.min(14, (slot * 0.8) / colors.length);
  let g = grid(8), vl = "";
  cats.forEach((c, i) => { if (c.pool) g += `<rect x="${(i * slot).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}" fill="#A78BFA" fill-opacity="0.16"/>`; });
  cats.forEach((c, i) => c.values.forEach((v, k) => {
    if (!isNum(v)) return;
    const h = Math.max(v / max * (H - 8), v > 0 ? 1 : 0), bx = i * slot + slot / 2 - (colors.length * bw) / 2 + k * bw;
    g += `<rect x="${bx.toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw - 1.5).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${colors[k]}"/>`;
    if (n <= 7) vl += `<span class="vl" style="left:${((bx + (bw - 1.5) / 2) / W * 100).toFixed(2)}%;bottom:${((h / H) * height + 2).toFixed(1)}px">${fmtV(v, max)}</span>`;
  }));
  const dense = n > 12, every = n > 20 ? Math.ceil(n / 8) : 1;
  const labs = cats.map((c, i) => `<span class="${c.bold ? "b" : ""}" style="width:${100 / n}%">${dense && i % every ? "" : esc(c.label)}${!dense && c.sub ? `<br>${esc(c.sub)}` : ""}${c.car ? `<br>${dense ? `<i class="cdot"></i>` : carIcon(13)}` : ""}</span>`).join("");
  const svg = `<div style="position:relative"><svg width="100%" height="${height}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${g}</svg>${vl}</div>`;
  const last = cats.reduce((a, c, i) => c.values.some(isNum) ? i : a, n - 1);
  return frame({ svg, hpx: height, max, pad: 8, axis: `<div class="bars-axis">${labs}</div>`, data: { n: cats.map(c => (c.ro || [c.label, c.sub].filter(Boolean).join(" ")) + (c.tag ? " · " + c.tag : "")), u: unit, dec: unit === "kWh/h" ? 2 : 1, def: last, s: colors.map((col, k) => ({ name: names[k] || "", c: col, v: cats.map(c => isNum(c.values[k]) ? Math.round(c.values[k] * 100) / 100 : null) })) } });
}

// Barras empilhadas por hora (24). stacks:[{values,color}]
export function stackedHourly({ stacks, nowIdx, label, names = [], unit = "kWh" }) {
  const tot = Array.from({ length: 24 }, (_, i) => stacks.reduce((a, s) => a + (isNum(s.values[i]) ? s.values[i] : 0), 0));
  const max = nice(Math.max(0.1, ...tot)), slot = W / 24;
  let g = grid(8);
  for (let i = 0; i < 24; i++) {
    let yb = H;
    for (const [k, s] of stacks.entries()) {
      const v = s.values[i]; if (!isNum(v) || v <= 0) continue;
      // Um valor real muito pequeno não deve desaparecer por ter menos de um pixel.
      const h = Math.max(v / max * (H - 8), 1);
      yb -= h;
      g += `<rect x="${(i * slot + 1).toFixed(1)}" y="${yb.toFixed(1)}" width="${(slot - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${s.color}"><title>${esc(names[k] || "")} ${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${esc(unit)}</title></rect>`;
    }
  }
  if (nowIdx != null) g += `<line x1="${((nowIdx + .5) * slot).toFixed(1)}" y1="0" x2="${((nowIdx + .5) * slot).toFixed(1)}" y2="${H}" stroke="rgba(255,255,255,0.5)" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`;
  const svg = `<svg width="100%" height="130" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${g}</svg>`;
  const axis = `<div class="axis"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>`;
  return frame({ svg, hpx: 130, max, pad: 8, axis, data: { n: Array.from({ length: 24 }, (_, i) => `${i}h–${i + 1}h`), u: unit, dec: 2, def: nowIdx, total: true, s: stacks.map((st, k) => ({ name: names[k] || "", c: st.color, v: st.values.map(v => isNum(v) ? Math.round(v * 100) / 100 : null) })) } });
}

export function sparkline({ values, color, labels }) {
  const v = values.filter(isNum); if (v.length < 2) return `<div class="empty">Sem dados suficientes ainda.</div>`;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = values.map((val, i) => [i / (values.length - 1) * (W - 8) + 2, H - 12 - ((val - lo) / span) * (H - 30)]);
  const line = pts.map(p => p.map(n => n.toFixed(1)).join(",")).join(" "), last = pts.at(-1);
  return `<svg width="100%" height="110" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evolução do saldo de créditos"><polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.2" fill="${color}"/></svg>
  <div class="axis two"><span>${esc(labels[0])}</span><span>${esc(labels[1])}</span></div>`;
}
