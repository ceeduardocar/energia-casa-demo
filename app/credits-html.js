// Bloco "Créditos no mês" da tela Créditos: saldo informado, conferência, totais, barras e saldo do mês.
import { isNum, kwh, esc } from "./util.js";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mes = (ref) => MESES[+ref.slice(5, 7) - 1];
const BAR_H = 150;

export function creditsHtml(rows, checks) {
  const used = rows.filter(r => isNum(r.compensated));
  if (!used.length) return "";
  const latest = [...rows].reverse().find(r => isNum(r.balance));
  const sum = (k) => used.reduce((a, r) => a + (r[k] ?? 0), 0);
  const first = used[0].ref, last = used.at(-1).ref;
  const periodo = first === last ? mes(first) : `${mes(first)}–${mes(last)}`;
  const max = Math.max(...used.map(r => r.compensated), 1), k = BAR_H / max;
  const check = checks.findLast(c => c.status !== "sem_dados");
  const conferencia = !check ? "" : check.status === "ok"
    ? `<div class="callout" style="border-color:rgba(255,255,255,.25);background:rgba(255,255,255,.04)"><div><b>Conferência ok</b>Saldo de ${mes(check.ref)} = saldo anterior + injetado − compensado.</div></div>`
    : `<div class="callout"><div><b>Conferência não fecha</b>Em ${mes(check.ref)} o saldo informado difere ${kwh(Math.abs(check.diff), 2)} kWh do cálculo mês a mês.</div></div>`;
  const bars = used.map(r => `
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;width:52px">
        <b style="font-size:11px">${kwh(r.compensated, 0)}</b>
        <div style="width:40px;height:${BAR_H}px;display:flex;flex-direction:column;justify-content:flex-end;border-radius:6px;overflow:hidden">
          <div style="height:${(r.old * k).toFixed(1)}px;background:#FFC266"></div>
          <div style="height:${(r.own * k).toFixed(1)}px;background:#5FD4F0"></div>
        </div>
        <span style="font-size:11px;font-weight:700">${mes(r.ref)}</span>
        <span style="font-size:10px;color:var(--mut)">consumo ${kwh(r.consumed, 0)}</span>
      </div>`).join("");
  const saldos = used.map(r => {
    const n = r.net, cor = n >= 0 ? "#5FD4F0" : "#FFC266", sinal = n >= 0 ? "+" : "−";
    return `<div style="display:flex;flex-direction:column;align-items:center;text-align:center"><span style="font-size:11px;color:var(--mut)">${mes(r.ref)}</span><b style="font-size:16px;color:${cor}">${sinal}${kwh(Math.abs(n), 0)}</b><span style="font-size:10px;color:var(--mut)">${n >= 0 ? "saldo subiu" : "usou saldo"}</span></div>`;
  }).join("");
  return `
  <section class="card big"><div style="font-size:14px;color:var(--mut)">Saldo informado na conta de ${latest ? mes(latest.ref) : "—"}</div>
    <div class="big-n" style="margin:6px 0 6px">${latest ? kwh(latest.balance, 2) : "—"}<u>kWh</u></div>
    <div style="font-size:12px;color:var(--mut);line-height:1.4">Só a conta da Neoenergia tem o saldo oficial. Abaixo, o que foi injetado, compensado e usado em cada mês.</div></section>
  ${conferencia}
  <div class="tiles t3">
    ${tileHtml("Injetado", kwh(sum("injected"), 0), "kWh", periodo)}
    ${tileHtml("Compensado", kwh(sum("compensated"), 0), "kWh", periodo)}
    ${tileHtml("Usou do saldo", kwh(sum("old"), 0), "kWh", "lotes antigos")}
  </div>
  <section class="card"><div class="sect" style="margin-bottom:8px"><b>Crédito usado por mês</b><span>kWh</span></div>
    <div style="display:flex;justify-content:space-around;align-items:flex-end">${bars}</div>
    <div class="legend"><span><i style="background:#5FD4F0"></i>do próprio mês</span><span><i style="background:#FFC266"></i>do saldo antigo</span></div>
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--bd)"><div style="font-size:12px;color:var(--mut);margin-bottom:8px">Saldo do mês: injetado − compensado (os 100 kWh mínimos já descontados)</div>
      <div style="display:grid;grid-template-columns:repeat(${used.length},1fr);gap:6px">${saldos}</div></div>
  </section>`;
}

const tileHtml = (k, v, u, s) => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${v}<u>${u}</u></div><div class="s">${esc(s)}</div></div>`;
