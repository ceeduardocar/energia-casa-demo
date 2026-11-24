import { esc, kwh, brl, mesNome, mesCurto, isNum } from "./util.js";
import { checks, measured, num, SAMPLE } from "./bills.js";

const fmtD = (d) => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "—";
const fmtDY = (d) => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—";
const fmtRef = (r) => r ? `${r.slice(5, 7)}/${r.slice(0, 4)}` : "—";
const refLong = (r) => `${mesCurto(+r.slice(5, 7) - 1)}/${r.slice(0, 4)}`;
const pctTxt = (a, b) => isNum(a) && b ? `${a >= b ? "+" : "−"}${Math.abs((a - b) / b * 100).toFixed(1).replace(".", ",")}%` : "—";
const n1 = (v) => isNum(v) ? new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v) : "—";
const ck = (c) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c ? "var(--ui)" : "var(--bad)"}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="${c ? "ok" : "falhou"}">${c ? '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>' : '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>'}</svg>`;

export function makeContas(ctx) {
  const { header, tabbar, svg, $app, go, state } = ctx;
  const A = () => ctx.api;

  /* ----- lista ----- */
  async function viewContas() {
    const [bills, checksRows] = await Promise.all([A().fetchBills(), A().fetchBillCheck().catch(() => [])]);
    const good = checksRows.find(c => !c.example && (c.status === "ok" || c.status === "atencao"));
    const latest = bills[0];
    $app.innerHTML = `<main>${header("Créditos", "Contas de luz", null, "creditos")}
    <label class="card link" style="border-style:dashed;border-color:rgba(255,255,255,.3);background:rgba(255,255,255,.04);cursor:pointer;gap:14px;justify-content:flex-start">
      <span style="width:48px;height:48px;border-radius:14px;background:rgba(255,255,255,.10);display:flex;align-items:center;justify-content:center;flex:none">${svg("upload", 22, "var(--ui)")}</span>
      <span class="rowtxt"><b>Enviar conta de luz</b><small>PDF da Neoenergia ou foto da conta</small></span>
      <input type="file" id="bf" accept="application/pdf,image/*" hidden></label>
    <section class="card"><div class="top" style="margin-bottom:10px"><h2>Medidor × Neoenergia</h2><span class="pill ${good ? (good.status === "ok" ? "ok" : "warn") : "warn"}">${good ? (good.status === "ok" ? "Dentro do esperado" : "Atenção") : "Aguardando"}</span></div>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#d8e6ef">${good ? `Último ciclo comparado: ${fmtRef(good.ref_month)}.` : `A comparação começa no primeiro ciclo completo gravado pelo coletor.${latest ? ` A conta de ${fmtRef(latest.ref_month)} é anterior a ele e serve de ponto de partida.` : ""}`}</p>
      ${good || A().mode === "demo" ? `<a href="#/relatorio" style="color:var(--ui);font-weight:700;text-decoration:none;font-size:14px;display:flex;justify-content:space-between">${good ? "Ver relatório" : "Ver exemplo do relatório"} ${svg("chev", 16, "var(--ui)", 2.4)}</a>` : ""}</section>
    <div class="cap">CONTAS IMPORTADAS</div>
    ${bills.length ? `<section class="card"><div class="list">${bills.map(b => `<div style="align-items:flex-start"><span><b style="display:block;font-size:16px">${fmtRef(b.ref_month)} · ${brl(num(b.total_brl) ?? 0)}</b><small style="color:var(--mut);font-size:12px;line-height:1.4;display:block;margin-top:2px">Leituras ${fmtD(b.reading_prev_date)} a ${fmtD(b.reading_curr_date)} · ${b.days} dias · ${kwh(num(b.kwh_billed), 0)} kWh faturados</small></span><span class="pill ok">Conferida</span></div>`).join("")}
      ${latest?.consumption_history?.length ? `<div style="display:block"><div style="display:flex;justify-content:space-between;align-items:flex-start"><span><b style="display:block;font-size:16px">Histórico de ${latest.consumption_history.length} meses</b><small style="color:var(--mut);font-size:12px">${refLong(latest.consumption_history[0].ref_month)} a ${refLong(latest.consumption_history.at(-1).ref_month)} · lido da própria conta</small></span><span class="pill" style="color:var(--mut);border-color:var(--bd)">Importado</span></div>
        ${histBars(latest.consumption_history)}</div>` : ""}</div></section>` : `<div class="card empty">Nenhuma conta importada ainda. Envie a primeira acima.</div>`}
    <div class="foot" style="text-align:left">Guardamos só os campos da conta. CPF, nome e endereço não são salvos.</div></main>${tabbar("creditos")}`;
    document.getElementById("bf").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      $app.querySelector("main").insertAdjacentHTML("beforeend", `<div class="foot" role="status">Lendo a conta…</div>`);
      try { const d = await A().parseBill(f); state.draft = d ? { ...d, file_name: f.name } : { file_name: f.name, extraction_method: "manual", meter_constant: 1 }; state.manual = !d; state.edit = !d; }
      catch (err) { state.draft = { file_name: f.name, extraction_method: "manual", meter_constant: 1 }; state.manual = true; state.edit = true; }
      location.hash = "#/conta";
    };
  }
  function histBars(h) { const mx = Math.max(...h.map(x => x.kwh), 1); const same = h.every(x => x.kwh === h[0].kwh);
    return `<div style="display:flex;gap:4px;align-items:flex-end;height:30px;margin:12px 0 6px" role="img" aria-label="Consumo faturado por mês">${h.map(x => `<span style="flex:1;height:${Math.max(x.kwh / mx * 100, 6)}%;background:rgba(255,255,255,.3);border-radius:3px"></span>`).join("")}</div><small style="color:var(--mut);font-size:12px">${same ? `${kwh(h[0].kwh, 0)} kWh faturados em todos os meses` : `${kwh(Math.min(...h.map(x => x.kwh)), 0)} a ${kwh(mx, 0)} kWh faturados por mês`}</small>`; }

  /* ----- conferir ----- */
  const FIELDS = {
    "Período": [["ref_month", "Referência", "month"], ["reading_prev_date", "Leitura anterior", "date"], ["reading_curr_date", "Leitura atual", "date"], ["next_reading_date", "Próxima leitura", "date"], ["days", "Dias", "num"]],
    "Medidor": [["meter_number", "Número do medidor", "text"], ["meter_reading_prev", "Leitura anterior", "num"], ["meter_reading_curr", "Leitura atual", "num"], ["meter_constant", "Constante", "num"], ["kwh_adjust_cat", "Ajuste CAT (kWh)", "num"], ["kwh_billed", "Faturado (kWh)", "num"], ["kwh_injected", "Injetada (kWh)", "num"], ["kwh_reactive", "Reativa, informativa (kWh)", "num"], ["credit_balance_kwh", "Saldo de créditos (kWh)", "num"]],
    "Valores (R$)": [["tusd_brl", "TUSD", "num"], ["te_brl", "TE", "num"], ["flag_brl", "Bandeira tarifária", "num"], ["interest_brl", "Juros", "num"], ["fine_brl", "Multa", "num"], ["public_lighting_brl", "Iluminação pública", "num"], ["other_brl", "Outros itens (ex.: ITAIPU)", "num"], ["total_brl", "Total a pagar", "num"]],
    "Identificação": [["access_key", "Chave de acesso da nota", "text"]]
  };
  const bad = (cs) => new Set(cs.filter(c => !c.ok).flatMap(c => c.fields));
  async function viewConta() {
    const b = state.draft; if (!b) { location.hash = "#/contas"; return; }
    const existing = (await A().fetchBills()).map(x => x.access_key);
    const render = () => {
      const cs = checks(b, existing), fails = cs.filter(c => !c.ok), B = bad(cs), m = measured(b);
      const row = (l, v, extra = "") => `<div><span style="color:var(--mut)">${l}</span><span class="r">${v} ${extra}</span></div>`;
      const mk = (k) => B.has(k) ? 'style="color:var(--bad)"' : "";
      const view = `
      <section class="card"><div class="cap" style="margin:0 0 6px">PERÍODO</div><div class="list">${row("Referência", fmtRef(b.ref_month))}${row("Leituras", `${fmtDY(b.reading_prev_date)} → ${fmtDY(b.reading_curr_date)}`)}${row("Dias", b.days ?? "—", ck(cs[0].ok))}</div></section>
      <section class="card"><div class="cap" style="margin:0 0 6px">MEDIDOR ${esc(b.meter_number || "")}</div><div class="list">
        ${row("Leitura", `${kwh(num(b.meter_reading_prev), 0)} → ${kwh(num(b.meter_reading_curr), 0)}`)}${row("Medido", `${kwh(m, 0)} kWh`)}${row("Ajuste CAT", `${isNum(num(b.kwh_adjust_cat)) ? (num(b.kwh_adjust_cat) < 0 ? "−" : "") + kwh(Math.abs(num(b.kwh_adjust_cat)), 0) : "—"} kWh`)}${row("Faturado", `${kwh(num(b.kwh_billed), 0)} kWh`, ck(cs[1].ok))}${row("Injetada", `${kwh(num(b.kwh_injected), 0)} kWh`)}
        <div><span style="color:var(--mut)">Reativa (informativa)</span><span class="r" style="color:var(--mut)">${kwh(num(b.kwh_reactive), 0)} kWh</span></div>${row("Saldo", `${kwh(num(b.credit_balance_kwh), 2)} kWh`)}</div></section>
      <section class="card"><div class="cap" style="margin:0 0 6px">VALORES</div><div class="list">${row("Iluminação pública", brl(num(b.public_lighting_brl) ?? 0))}${row("Total a pagar", brl(num(b.total_brl) ?? 0), ck(cs[2].ok))}</div></section>`;
      const edit = `<form id="ef" class="form" autocomplete="off">${Object.entries(FIELDS).map(([g, fs]) => `<section class="card"><div class="cap" style="margin:0 0 10px">${g.toUpperCase()}</div><div class="form">${fs.map(([k, l, t]) => `<label ${B.has(k) ? 'style="color:var(--bad)"' : ""}>${l}<input name="${k}" type="${t === "num" ? "text" : t}" ${t === "num" ? 'inputmode="decimal"' : ""} value="${esc(b[k] ?? "")}" ${B.has(k) ? 'aria-invalid="true" style="border-color:var(--bad)"' : ""}></label>`).join("")}</div></section>`).join("")}</form>`;
      $app.innerHTML = `<main>${header(`Conta ${fmtRef(b.ref_month)}`, "Conferir conta", null, "contas")}
        <div class="foot" style="display:flex;justify-content:space-between;padding:0 2px;text-align:left"><span>${esc(b.file_name || "")}</span><span>${state.manual ? "Digitado por você" : b.extraction_method === "vision" ? "Lido da foto" : "Lido do texto do PDF"}</span></div>
        ${state.manual ? `<div class="err" style="border-color:rgba(255,194,102,.5);background:rgba(255,194,102,.08)">A leitura automática ainda não está ligada. Digite os campos como estão impressos na conta.</div>` : ""}
        <div class="card" style="display:block;border-color:${fails.length ? "rgba(255,138,128,.5)" : "rgba(255,255,255,.25)"};background:${fails.length ? "rgba(255,138,128,.07)" : "rgba(255,255,255,.05)"}" role="status"><b style="font-size:14px">${fails.length ? `${cs.length - fails.length} verificações passaram · ${fails.length} pendente${fails.length > 1 ? "s" : ""}` : `${cs.length} verificações passaram · 0 pendentes`}</b>
          ${fails.length ? `<ul style="margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.5;color:#ffd0cc">${fails.map(c => `<li>${c.label}</li>`).join("")}</ul>` : ""}</div>
        ${state.edit ? edit : view}
        <div style="display:flex;gap:10px"><button class="btn ghost" id="ed" style="flex:1">${state.edit ? "Ver resumo" : "Editar campos"}</button><button class="btn" id="ok" style="flex:1.4">Confirmar e salvar</button></div>
        <div class="foot" id="cmsg" role="status">Só grava depois da sua confirmação. O saldo vira o novo ponto de partida dos créditos.</div></main>${tabbar("creditos")}`;
      document.getElementById("ed").onclick = () => { state.edit = !state.edit; render(); };
      const ef = document.getElementById("ef");
      if (ef) ef.oninput = (e) => { const k = e.target.name, t = e.target.type; b[k] = t === "text" && e.target.inputMode === "decimal" ? num(e.target.value) ?? e.target.value : e.target.value; };
      if (ef) ef.addEventListener("change", () => { const y = window.scrollY; render(); window.scrollTo(0, y); });
      document.getElementById("ok").onclick = async () => {
        const cs2 = checks(b, existing), f2 = cs2.filter(c => !c.ok), msg = document.getElementById("cmsg");
        if (!b.reading_curr_date || !isNum(num(b.credit_balance_kwh))) { msg.textContent = "Preencha ao menos a data da leitura atual e o saldo de créditos."; return; }
        if (f2.some(c => c.id === "dup")) { msg.textContent = "Esta conta já foi importada."; return; }
        if (f2.length && !confirm(`${f2.length} verificação(ões) pendente(s). Salvar mesmo assim?`)) return;
        const row = { ...b }; for (const [, fs] of Object.entries(FIELDS)) for (const [k, , t] of fs) if (t === "num") row[k] = num(row[k]); row.kwh_measured = measured(b);
        if (row.ref_month && row.ref_month.length === 7) row.ref_month = row.ref_month + "-01";
        try { msg.textContent = "Salvando…"; await A().saveBill(row); state.draft = null; state.manual = false; state.edit = false; location.hash = "#/contas"; }
        catch (err) { msg.textContent = "Não consegui salvar: " + err.message; }
      };
    };
    render();
  }

  /* ----- relatório ----- */
  async function viewRelatorio() {
    const rows = await A().fetchBillCheck().catch(() => []), r = rows[0];
    if (!r) { $app.innerHTML = `<main>${header("Medidor × Neoenergia", "Relatório", null, "contas")}<div class="card empty">Ainda não há ciclo para comparar. O relatório aparece depois do primeiro ciclo completo gravado pelo coletor e de uma conta importada.</div></main>${tabbar("creditos")}`; return; }
    const sem = r.status === "sem_cobertura", cov = r.coverage != null ? `${(r.coverage * 100).toFixed(1).replace(".", ",")}%` : "—";
    const block = (title, color, house, bill) => { const mx = Math.max(house, bill, 1), d = house - bill, p = bill ? Math.abs(d / bill * 100) : 0;
      return `<section class="card"><div class="top" style="margin-bottom:12px"><h2><i class="dot" style="background:${color};border-radius:50%"></i>${title}</h2><span class="pill ${p > 5 ? "warn" : "ok"}">${pctTxt(house, bill)}</span></div>
      <div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px 10px;align-items:center;font-size:13px"><span style="color:var(--mut)">Seu medidor</span><span style="height:8px;border-radius:5px;background:${color};width:${house / mx * 100}%"></span><b>${n1(house)} kWh</b><span style="color:var(--mut)">Neoenergia</span><span style="height:8px;border-radius:5px;background:#9fb3c2;width:${bill / mx * 100}%"></span><b>${n1(bill)} kWh</b></div>
      <div style="font-size:12px;color:var(--mut);margin-top:10px">Diferença: ${d >= 0 ? "+" : "−"}${n1(Math.abs(d))} kWh</div></section>`; };
    const att = r.status === "atencao";
    $app.innerHTML = `<main>${header("Medidor × Neoenergia", "Relatório", null, "contas")}
    <div style="display:flex;justify-content:space-between;align-items:center"><div><b style="font-size:16px">Ciclo ${fmtRef(r.ref_month)}${r.example ? " (exemplo)" : ""}</b><div style="font-size:12px;color:var(--mut)">Leituras ${fmtD(r.reading_prev_date)} a ${fmtD(r.reading_curr_date)} · ${r.days} dias</div></div><span class="pill ${sem ? "warn" : "ok"}">Cobertura ${cov}</span></div>
    ${sem ? `<div class="card empty">Sem cobertura suficiente neste ciclo: o coletor ainda não cobria o período inteiro.</div>` : `${block("Importado da rede", "#FF8A80", r.house_import_kwh, r.bill_import_kwh)}${block("Exportado para a rede", "var(--ui)", r.house_export_kwh, r.bill_export_kwh)}
    <div class="callout" style="${att ? "" : "background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.2)"}"><span>${ck(!att)}</span><div><b>${att ? "Diferença acima do esperado" : "Dentro do esperado"}</b>${att ? "A diferença passou de 5%. Confira se a leitura da distribuidora está correta e se o seu medidor ficou sem comunicar em algum período." : "São medidores diferentes e as leituras da distribuidora não caem à meia-noite, então 1% a 3% de diferença é normal. O app avisa quando passar de 5%."}</div></div>`}
    <div style="display:flex;gap:10px"><button class="btn ghost" style="flex:1" id="pdf">Baixar PDF</button><button class="btn ghost" style="flex:1" id="shr">Compartilhar</button></div></main>${tabbar("creditos")}`;
    document.getElementById("pdf").onclick = () => window.print();
    document.getElementById("shr").onclick = async () => { const t = `EnergyKontrol · ciclo ${fmtRef(r.ref_month)}: importado ${n1(r.house_import_kwh)} kWh (meu medidor) × ${n1(r.bill_import_kwh)} kWh (Neoenergia); exportado ${n1(r.house_export_kwh)} × ${n1(r.bill_export_kwh)} kWh.`; try { if (navigator.share) await navigator.share({ text: t }); else await navigator.clipboard.writeText(t); } catch {} };
  }
  return { contas: viewContas, conta: viewConta, relatorio: viewRelatorio };
}
