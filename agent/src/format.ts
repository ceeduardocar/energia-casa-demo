// Arredondamento e escrita de números em português, num lugar só (ferramentas, RAG e política offline).

// Duas casas para os campos das ferramentas; null para o que não é número finito.
export const r2 = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null;

const SEM = "sem dado";

// Uma casa, vírgula decimal: "19,5".
export const f1 = (v: number | null | undefined) => (v == null ? SEM : v.toFixed(1).replace(".", ","));

// Até duas casas, com milhar: "2.038,67".
export const f2 = (v: number | null | undefined) =>
  v == null ? SEM : v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Para os textos das contas no RAG.
export const kwhText = (v: unknown) => (typeof v === "number" ? `${String(v).replace(".", ",")} kWh` : "não informado");
export const brlText = (v: unknown) => (typeof v === "number" ? `R$ ${v.toFixed(2).replace(".", ",")}` : "não informado");
