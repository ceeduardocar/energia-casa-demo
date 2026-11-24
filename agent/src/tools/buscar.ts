// buscar_documentos: RAG híbrido nas coleções permitidas ao expert. Cada trecho volta com o caminho, para citar.
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { Embeddings } from "@langchain/core/embeddings";
import type { Hit, VectorStore } from "../rag/store.ts";

export type RagDeps = { store: VectorStore; embeddings: Embeddings; k?: number; alpha?: number; onHits?: (q: string, hits: Hit[]) => void };

export async function buscar(deps: RagDeps, colecoes: readonly string[], consulta: string) {
  const vector = await deps.embeddings.embedQuery(consulta);
  const hits = await deps.store.hybrid(colecoes, consulta, vector, deps.k ?? 4, deps.alpha ?? 0.5);
  deps.onHits?.(consulta, hits);
  return hits;
}

export function buscarTool(deps: RagDeps, colecoes: readonly [string, ...string[]]) {
  return tool(
    async ({ consulta, colecao }) => {
      const alvo = colecao ? [colecao] : colecoes;
      const hits = await buscar(deps, alvo, consulta);
      return JSON.stringify({
        trechos: hits.map(h => ({ colecao: h.colecao, titulo: h.titulo, caminho: h.caminho, score: Math.round(h.score * 1000) / 1000, texto: h.texto })),
        fonte: "Weaviate (busca híbrida)",
      });
    },
    {
      name: "buscar_documentos",
      description: `Busca trechos de documentos (regras, decisões do projeto, contas, resumos de dias) por significado e por palavra-chave. Coleções: ${colecoes.join(", ")}.`,
      schema: z.object({
        consulta: z.string().min(3).describe("O que procurar, em português"),
        colecao: z.enum(colecoes).optional().describe("Limitar a uma coleção"),
      }),
    },
  );
}
