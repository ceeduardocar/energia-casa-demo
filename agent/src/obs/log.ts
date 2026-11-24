// Registro estruturado por pergunta (JSONL). Um arquivo por dia em agent/logs/, ignorado pelo Git.
import { appendFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export type Passo = { ferramenta: string; args: unknown; ms: number; ok: boolean; erro?: string; bytes: number };
export type Recuperado = { consulta: string; colecao: string; caminho: string; titulo: string; score: number };
export type Registro = {
  id: string; inicio: string; pergunta: string; hoje: string;
  modelo: string; dados: string; store: string;
  rota: { expert: string; motivo: string; reserva: boolean; ms: number };
  passos: Passo[]; recuperados: Recuperado[];
  tokens: { entrada: number; saida: number; chamadas_llm: number };
  checagem: { ok: boolean; verificados: number; sem_fonte: string[] };
  resposta: string; ms_total: number; erro?: string;
};

export const LOG_DIR = fileURLToPath(new URL("../../logs/", import.meta.url));

export interface Logger { write(r: Registro): Promise<void> }

export const fileLogger = (dir = LOG_DIR): Logger => ({
  async write(r) {
    await mkdir(dir, { recursive: true });
    await appendFile(`${dir}${r.inicio.slice(0, 10)}.jsonl`, JSON.stringify(r) + "\n");
  },
});

export const memoryLogger = () => {
  const rows: Registro[] = [];
  return { rows, async write(r: Registro) { rows.push(r); } };
};
