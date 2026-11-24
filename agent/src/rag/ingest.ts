// Indexa os trechos no store: apaga as coleções, calcula os vetores em lotes e grava.
import type { Embeddings } from "@langchain/core/embeddings";
import type { Chunk } from "./chunk.ts";
import { COLECOES, type VectorStore } from "./store.ts";

export async function ingest(store: VectorStore, emb: Embeddings, chunks: Chunk[], batch = 50) {
  await store.reset(COLECOES);
  for (let i = 0; i < chunks.length; i += batch) {
    const part = chunks.slice(i, i + batch);
    const vectors = await emb.embedDocuments(part.map(c => `${c.titulo}\n${c.texto}`));
    await store.add(part.map((c, j) => ({ ...c, vector: vectors[j] })));
  }
  const counts: Record<string, number> = {};
  for (const c of COLECOES) counts[c] = await store.count(c);
  return counts;
}
