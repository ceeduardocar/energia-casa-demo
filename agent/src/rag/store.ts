// Store vetorial do RAG. Duas implementações com a mesma interface: memória (testes) e Weaviate (laboratório).
import type { Chunk } from "./chunk.ts";
import { cosine } from "./embeddings.ts";
import { tokens } from "./text.ts";

export const COLECOES = ["ProjetoDocs", "RegrasEnergia", "Contas", "ResumoDiario"] as const;
export type Colecao = (typeof COLECOES)[number];

export type StoredChunk = Chunk & { vector: number[] };
export type Hit = Chunk & { score: number };

export interface VectorStore {
  readonly name: string;
  reset(colecoes: readonly string[]): Promise<void>;
  add(chunks: StoredChunk[]): Promise<void>;
  count(colecao: string): Promise<number>;
  // Busca híbrida: alpha = 1 só vetor, alpha = 0 só BM25.
  hybrid(colecoes: readonly string[], query: string, vector: number[], k: number, alpha: number): Promise<Hit[]>;
  close?(): Promise<void>;
}

const minmax = (xs: number[]) => {
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return xs.map(x => (hi > lo ? (x - lo) / (hi - lo) : hi > 0 ? 1 : 0));
};

// BM25 (k1 = 1.2, b = 0.75) sobre título + texto.
export function bm25Scores(docs: string[][], q: string[], k1 = 1.2, b = 0.75): number[] {
  const N = docs.length, avg = docs.reduce((a, d) => a + d.length, 0) / (N || 1);
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  return docs.map(d => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const t of new Set(q)) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg));
    }
    return s;
  });
}

// Fusão por pontuação relativa: cada lado normalizado (min-max) dentro da consulta, depois alpha·vetor + (1−alpha)·bm25.
export class MemoryStore implements VectorStore {
  readonly name = "memory";
  private items: StoredChunk[] = [];
  async reset(colecoes: readonly string[]) { this.items = this.items.filter(c => !colecoes.includes(c.colecao)); }
  async add(chunks: StoredChunk[]) { this.items.push(...chunks); }
  async count(colecao: string) { return this.items.filter(c => c.colecao === colecao).length; }
  async hybrid(colecoes: readonly string[], query: string, vector: number[], k: number, alpha: number): Promise<Hit[]> {
    const pool = this.items.filter(c => colecoes.includes(c.colecao));
    if (!pool.length) return [];
    const vec = minmax(pool.map(c => cosine(vector, c.vector)));
    const kw = minmax(bm25Scores(pool.map(c => tokens(c.titulo + " " + c.texto)), tokens(query)));
    return pool
      .map((c, i) => ({ colecao: c.colecao, titulo: c.titulo, caminho: c.caminho, texto: c.texto, score: alpha * vec[i] + (1 - alpha) * kw[i] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
