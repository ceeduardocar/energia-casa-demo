// Leitura da conta digital da Neoenergia Brasília (PDF com texto), no próprio aparelho.
// O arquivo não sai do celular. Só os campos da spec (seção 5.1) são extraídos:
// nome, CPF, endereço e códigos do cliente são ignorados.

// pdf.js 4.10.38 (pdfjs-dist, Apache-2.0) fica em vendor/pdfjs: o PDF da conta (com CPF) e a senha
// só passam por código servido pelo próprio app, sem CDN de terceiros.
const PDFJS = new URL("./vendor/pdfjs/pdf.min.mjs", import.meta.url).href;
const PDFJS_WORKER = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;

// Itens de texto do pdf.js -> linhas (de cima para baixo), cada uma com suas células (da esquerda para a direita).
export function linesFromItems(items) {
  const rows = new Map();
  for (const it of items) {
    const s = it.str.trim();
    if (!s) continue;
    const y = Math.round(it.transform[5]);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push({ x: it.transform[4], s });
  }
  return [...rows.keys()].sort((a, b) => b - a).map(y => rows.get(y).sort((a, b) => a.x - b.x).map(c => c.s));
}

// Abre o PDF no navegador e devolve as linhas da 1ª página. askPassword(retry) devolve a senha ou null.
export async function readPdfLines(file, askPassword) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false, // sem eval/new Function para fontes (a CSP também não permite)
  });
  task.onPassword = (update, reason) => {
    const p = askPassword(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    if (p == null) task.destroy(); else update(p);
  };
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const { items } = await page.getTextContent();
  await doc.destroy();
  return linesFromItems(items);
}

// "14.172,00" -> 14172 ; "8,96-" -> -8.96 ; "- 210" -> -210
export function brNum(s) {
  if (s == null) return null;
  let t = String(s).replace(/\s+/g, "");
  let neg = false;
  if (t.endsWith("-")) { neg = true; t = t.slice(0, -1); }
  if (t.startsWith("-")) { neg = true; t = t.slice(1); }
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(t)) return null;
  const n = parseFloat(t.replace(/\./g, "").replace(",", "."));
  return neg ? -n : n;
}
const isoDate = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || ""); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const round = (v, d = 2) => v == null ? null : Math.round(v * 10 ** d) / 10 ** d;
const after = (cells, label) => { const i = cells.findIndex(c => c.toUpperCase().startsWith(label)); return i >= 0 ? cells[i + 1] : undefined; };

// Linhas -> campos da conta (nomes das colunas de `bills`), ou null se não parecer uma conta da Neoenergia.
export function parseBillLines(lines) {
  const text = lines.map(l => l.join(" ")).join("\n");
  const compact = text.replace(/\s+/g, "");
  const b = { extraction_method: "pdf_text" };

  // referência, total impresso no topo e vencimento: "08/2026 | 0,00 | 23/09/2026"
  const top = lines.find(l => l.length === 3 && /^\d{2}\/\d{4}$/.test(l[0]) && brNum(l[1]) != null && isoDate(l[2]));
  if (top) { b.ref_month = `${top[0].slice(3)}-${top[0].slice(0, 2)}`; b.due_date = isoDate(top[2]); }

  const em = /DATA DE EMISS[ÃA]O:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(text);
  if (em) b.issue_date = isoDate(em[1]);

  const key = /(\d{4}(?: \d{4}){10})/.exec(text);
  if (key) b.access_key = key[1].replace(/ /g, "");

  const cls = lines.find(l => l.some(c => /^CLASSIFICA[ÇC][ÃA]O:/i.test(c)));
  if (cls) {
    b.class = after(cls, "CLASSIFICA")?.replace(/\s*-.*$/, "").trim() || null;
    const sup = after(cls, "TIPO DE FORNECIMENTO");
    if (sup) b.supply_type = sup.split(" - ").pop().trim();
  }

  const dl = lines.find(l => l.some(c => /^LEITURA ANTERIOR$/i.test(c)));
  if (dl) {
    b.reading_prev_date = isoDate(after(dl, "LEITURA ANTERIOR"));
    b.reading_curr_date = isoDate(after(dl, "LEITURA ATUAL"));
    b.days = parseInt(after(dl, "N° DE DIAS") ?? after(dl, "Nº DE DIAS"), 10) || null;
    b.next_reading_date = isoDate(after(dl, "PRÓXIMA LEITURA") ?? after(dl, "PROXIMA LEITURA"));
  }

  // itens da fatura (entre o cabeçalho e o quadro de consumo); impostos ficam de fora
  const i0 = lines.findIndex(l => /^ITENS DA FATURA/i.test(l[0]));
  const i1 = lines.findIndex(l => /^CONSUMO \/ kWh/i.test(l[0]));
  if (i0 >= 0) {
    Object.assign(b, { tusd_brl: null, te_brl: null, flag_brl: null, flag_name: null, interest_brl: null, fine_brl: null, public_lighting_brl: null, other_brl: 0 });
    const add = (k, v) => { b[k] = round((b[k] ?? 0) + v); };
    for (const l of lines.slice(i0 + 1, i1 > i0 ? i1 : undefined)) {
      const name = l[0];
      if (/^(PIS|COFINS|ICMS)$/i.test(name) || /^COM TRIB/i.test(name) || l.length < 2) continue;
      const v = brNum(l[1] === "kWh" ? l[4] : l[1]);
      if (v == null) continue;
      if (/^Consumo-TUSD/i.test(name)) add("tusd_brl", v);
      else if (/^Consumo-TE/i.test(name)) add("te_brl", v);
      else if (/Band/i.test(name)) { add("flag_brl", v); b.flag_name = name.split(/\s+/).pop().toLowerCase(); }
      else if (/Ilum/i.test(name)) add("public_lighting_brl", v);
      else if (/^Juros/i.test(name)) add("interest_brl", v);
      else if (/^Multa/i.test(name)) add("fine_brl", v);
      else add("other_brl", v);
    }
  }
  const tot = lines.find(l => l.length === 2 && /^TOTAL$/i.test(l[0]) && brNum(l[1]) != null);
  if (tot) b.total_brl = brNum(tot[1]);

  // histórico impresso: "AGO26 | 100 | 30"
  const hist = [];
  for (const l of lines) {
    const m = l.length === 3 && /^([A-Z]{3})(\d{2})$/.exec(l[0]);
    if (!m || !MESES.includes(m[1])) continue;
    hist.push({ ref_month: `20${m[2]}-${String(MESES.indexOf(m[1]) + 1).padStart(2, "0")}`, kwh: brNum(l[1]), days: parseInt(l[2], 10) });
  }
  b.consumption_history = hist.sort((a, c) => a.ref_month.localeCompare(c.ref_month));

  // medidor: "1234567 | Energia Ativa | Único | 14.172,00 | 14.482,00 | 1,00000 | 100,00"
  const at = lines.find(l => l[1] === "Energia Ativa" && l.length >= 7);
  if (at) {
    b.meter_number = at[0];
    b.meter_reading_prev = brNum(at[3]);
    b.meter_reading_curr = brNum(at[4]);
    b.meter_constant = brNum(at[5]);
    b.kwh_billed = brNum(at[6]);
    if (b.meter_reading_prev != null && b.meter_reading_curr != null)
      b.kwh_measured = round((b.meter_reading_curr - b.meter_reading_prev) * (b.meter_constant ?? 1), 3);
  }
  const re = lines.find(l => l[1] === "Energia Reativa" && l.length >= 7);
  if (re) b.kwh_reactive = brNum(re[6]);

  // avisos em texto corrido (a quebra de linha pode cair no meio da palavra: "proxi mo")
  const cat = /CATde(-?)([\d.,]+)kWh/i.exec(compact);
  if (cat) b.kwh_adjust_cat = (cat[1] ? -1 : 1) * brNum(cat[2]);
  const inj = /Energiainjetadanom[eê]s([\d.,]+)kWh/i.exec(compact);
  if (inj) b.kwh_injected = brNum(inj[1]);
  const sal = /Saldoparaopr[oó]ximociclo([\d.,]+)kWh/i.exec(compact);
  if (sal) b.credit_balance_kwh = brNum(sal[1]);

  return b.ref_month && b.reading_curr_date ? b : null;
}

// Pergunta a senha do PDF na tela. A senha não é guardada.
export const promptPassword = (retry) => window.prompt(retry
  ? "Senha incorreta. Tente de novo:"
  : "Esta conta está protegida por senha (a Neoenergia costuma usar parte do CPF do titular). Digite a senha para o app ler o PDF. Ela não é guardada:");

// Arquivo -> campos da conta, ou null se não der para ler (foto, PDF sem texto ou layout diferente).
export async function parseBillFile(file, askPassword = promptPassword) {
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) return null;
  return parseBillLines(await readPdfLines(file, askPassword));
}
