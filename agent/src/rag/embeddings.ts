// Embeddings: Gemini (padrão com chave) ou local por hashing (testes e laboratório sem rede).
import { Embeddings } from "@langchain/core/embeddings";
import { tokens } from "./text.ts";

// Hashing de palavras e bigramas em `dim` posições, com sinal, normalizado. Determinístico e sem rede.
// Não entende sinônimos, mas aproxima textos com as mesmas palavras; o BM25 da busca híbrida faz o resto.
export class HashEmbeddings extends Embeddings {
  dim: number;
  constructor(dim = 256) {
    super({});
    this.dim = dim;
  }
  vector(text: string): number[] {
    const v = new Array(this.dim).fill(0);
    const t = tokens(text);
    const feats = [...t, ...t.slice(1).map((x, i) => t[i] + "_" + x)];
    for (const f of feats) {
      let h = 2166136261;
      for (let i = 0; i < f.length; i++) h = Math.imul(h ^ f.charCodeAt(i), 16777619);
      v[(h >>> 0) % this.dim] += h & 1 ? 1 : -1;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map(x => x / norm);
  }
  async embedDocuments(texts: string[]) { return texts.map(t => this.vector(t)); }
  async embedQuery(text: string) { return this.vector(text); }
}

export async function geminiEmbeddings(apiKey: string, model = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001"): Promise<Embeddings> {
  const { GoogleGenerativeAIEmbeddings } = await import("@langchain/google-genai");
  return new GoogleGenerativeAIEmbeddings({ apiKey, model });
}

export const cosine = (a: number[], b: number[]) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
};
