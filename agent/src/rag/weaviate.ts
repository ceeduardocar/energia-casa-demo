// Store no Weaviate: uma coleção por fonte, vetores calculados no cliente (selfProvided) e busca híbrida nativa.
import weaviate, { type WeaviateClient } from "weaviate-client";
import type { Hit, StoredChunk, VectorStore } from "./store.ts";

export type WeaviateOptions = { host?: string; port?: number; grpcPort?: number };

export async function weaviateStore(opts: WeaviateOptions = {}): Promise<VectorStore> {
  const client: WeaviateClient = await weaviate.connectToLocal({
    host: opts.host ?? process.env.WEAVIATE_HOST ?? "localhost",
    port: opts.port ?? Number(process.env.WEAVIATE_PORT ?? 8080),
    grpcPort: opts.grpcPort ?? Number(process.env.WEAVIATE_GRPC_PORT ?? 50051),
  });
  return {
    name: "weaviate",
    async reset(colecoes) {
      for (const nome of colecoes) {
        if (await client.collections.exists(nome)) await client.collections.delete(nome);
        await client.collections.create({
          name: nome,
          properties: [
            { name: "titulo", dataType: weaviate.configure.dataType.TEXT },
            { name: "caminho", dataType: weaviate.configure.dataType.TEXT, skipVectorization: true },
            { name: "texto", dataType: weaviate.configure.dataType.TEXT },
          ],
          vectorizers: weaviate.configure.vectors.selfProvided(),
        });
      }
    },
    async add(chunks: StoredChunk[]) {
      const by = new Map<string, StoredChunk[]>();
      for (const c of chunks) by.set(c.colecao, [...(by.get(c.colecao) ?? []), c]);
      for (const [nome, cs] of by) {
        const res = await client.collections.use(nome).data.insertMany(
          cs.map(c => ({ properties: { titulo: c.titulo, caminho: c.caminho, texto: c.texto }, vectors: c.vector })),
        );
        if (res.hasErrors) throw new Error(`Weaviate: ${Object.keys(res.errors).length} trechos com erro em ${nome}`);
      }
    },
    async count(colecao) {
      if (!(await client.collections.exists(colecao))) return 0;
      const r = await client.collections.use(colecao).aggregate.overAll();
      return r.totalCount;
    },
    async hybrid(colecoes, query, vector, k, alpha): Promise<Hit[]> {
      const hits: Hit[] = [];
      for (const nome of colecoes) {
        if (!(await client.collections.exists(nome))) continue;
        const r = await client.collections.use(nome).query.hybrid(query, { vector, alpha, limit: k, returnMetadata: ["score"] });
        for (const o of r.objects) {
          const p = o.properties as Record<string, string>;
          hits.push({ colecao: nome, titulo: p.titulo, caminho: p.caminho, texto: p.texto, score: o.metadata?.score ?? 0 });
        }
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, k);
    },
    async close() { await client.close(); },
  };
}
