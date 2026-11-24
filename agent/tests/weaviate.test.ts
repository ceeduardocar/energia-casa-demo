// Store Weaviate de verdade. Roda quando WEAVIATE_HOST existe (no CI, o job do assistente sobe o Weaviate;
// localmente, `docker compose -f agent/lab/docker-compose.yml up -d`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { weaviateStore } from "../src/rag/weaviate.ts";
import { HashEmbeddings } from "../src/rag/embeddings.ts";
import { ingest } from "../src/rag/ingest.ts";
import { allChunks } from "../src/rag/sources.ts";
import { demoProvider } from "../src/data/demo.ts";
import { buscar } from "../src/tools/buscar.ts";

const on = !!process.env.WEAVIATE_HOST;

test("weaviate: indexa as quatro coleções e a busca híbrida acha o mínimo faturado", { skip: !on && "sem WEAVIATE_HOST" }, async () => {
  const store = await weaviateStore();
  try {
    const e = new HashEmbeddings();
    const chunks = await allChunks(demoProvider(), "2026-11-20");
    const counts = await ingest(store, e, chunks);
    assert.equal(counts.ResumoDiario, 30);
    assert.equal(counts.Contas, 5);
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), chunks.length);
    const hits = await buscar({ store, embeddings: e }, ["RegrasEnergia", "Contas"], "por que a conta vem com 100 kWh de mínimo faturado");
    assert.ok(hits.length > 0);
    assert.equal(hits[0].caminho, "agent/knowledge/regras-energia.md");
    assert.ok(hits.every((h, i) => i === 0 || hits[i - 1].score >= h.score));
  } finally {
    await store.close!();
  }
});
