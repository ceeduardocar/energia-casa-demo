// Fontes do RAG: documentos do repositório, regras de energia, contas de exemplo e um resumo por dia.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseBillLines } from "../../../app/billparse.js";
import { addDays, dow } from "../../../app/util.js";
import { chunkMarkdown, type Chunk } from "./chunk.ts";
import { brlText as brl, f1, kwhText as kwh } from "../format.ts";
import type { DataProvider } from "../data/provider.ts";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// Só documentos sem segredo. O CLAUDE.md fica de fora (tem identificadores da planta e da conta); as regras
// do sistema que ele registra estão resumidas em agent/knowledge/regras-energia.md.
export const PROJETO_DOCS = [
  "README.md",
  "app/README.md",
  "agent/README.md",
  "docs/superpowers/specs/2026-10-08-energia-casa-design.md",
  "docs/superpowers/specs/2026-11-23-assistente-design.md",
  "docs/2026-11-22-isolamento-seguranca-supabase.md",
];
export const REGRAS = ["agent/knowledge/regras-energia.md"];
export const CONTAS = ["05", "06", "07", "08", "09"].map(m => `app/tests/fixtures/conta-${m}-2026.json`);

async function readIfExists(rel: string) {
  try { return await readFile(join(ROOT, rel), "utf8"); } catch { return null; }
}

export async function docChunks(files: string[], colecao: string): Promise<Chunk[]> {
  const out: Chunk[] = [];
  for (const f of files) {
    const md = await readIfExists(f);
    if (md) out.push(...chunkMarkdown(md, f, colecao));
  }
  return out;
}


// Uma conta vira um texto curto em português, com os campos que o leitor do app extrai (sem nome, CPF ou endereço).
export function billText(b: Record<string, any>): string {
  const hist = (b.consumption_history ?? []).map((h: any) => `${h.ref_month}: ${h.kwh} kWh`).join("; ");
  return [
    `Conta Neoenergia de referência ${b.ref_month}, classe ${b.class ?? "?"}, fornecimento ${b.supply_type ?? "?"}.`,
    `Leituras de ${b.reading_prev_date} a ${b.reading_curr_date} (${b.days} dias); próxima leitura ${b.next_reading_date}.`,
    `Medidor: leitura anterior ${b.meter_reading_prev ?? "?"}, atual ${b.meter_reading_curr ?? "?"}. Consumo faturado ${kwh(b.kwh_billed)}, ajuste CAT ${kwh(b.kwh_adjust_cat)}, energia injetada ${kwh(b.kwh_injected)}, saldo de créditos ${kwh(b.credit_balance_kwh)}.`,
    `Valores: TUSD ${brl(b.tusd_brl)}, TE ${brl(b.te_brl)}, bandeira ${b.flag_name ?? "?"} ${brl(b.flag_brl)}, juros ${brl(b.interest_brl)}, multa ${brl(b.fine_brl)}, iluminação pública ${brl(b.public_lighting_brl)}, total ${brl(b.total_brl)}, vencimento ${b.due_date}.`,
    hist ? `Histórico de consumo faturado: ${hist}.` : "",
  ].filter(Boolean).join("\n");
}

export async function billChunks(): Promise<Chunk[]> {
  const out: Chunk[] = [];
  for (const f of CONTAS) {
    const raw = await readIfExists(f);
    if (!raw) continue;
    const b = parseBillLines(JSON.parse(raw));
    if (b) out.push({ colecao: "Contas", titulo: `Conta ${b.ref_month}`, caminho: f, texto: billText(b) });
  }
  return out;
}


export async function dailyChunks(data: DataProvider, today: string, days = 30): Promise<Chunk[]> {
  const rows = await data.days(addDays(today, -days), addDays(today, -1));
  return rows.map(r => ({
    colecao: "ResumoDiario",
    titulo: `Dia ${r.day} (${dow(r.day)})`,
    caminho: `v_house_daily/${r.day}`,
    texto: `Em ${r.day} (${dow(r.day)}) a casa consumiu ${f1(r.consumo)} kWh: ar-condicionado ${f1(r.ac)}, boiler ${f1(r.bo)}, outros ${f1(r.outros)}. ` +
      `Geração solar ${f1(r.g)} kWh, importado da rede ${f1(r.i)}, exportado ${f1(r.e)}, autossuficiência ${r.autossuficiencia == null ? "sem dado" : Math.round(r.autossuficiencia * 100) + "%"}.`,
  }));
}

export async function allChunks(data: DataProvider, today: string) {
  return [
    ...(await docChunks(PROJETO_DOCS, "ProjetoDocs")),
    ...(await docChunks(REGRAS, "RegrasEnergia")),
    ...(await billChunks()),
    ...(await dailyChunks(data, today)),
  ];
}
