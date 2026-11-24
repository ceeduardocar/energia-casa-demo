// Indexa as quatro coleções no store escolhido (para o Weaviate, uma vez antes de perguntar).
//   node src/rag/ingest-cli.ts --store weaviate [--embed gemini] [--data postgres]
import { systemClock } from "../clock.ts";
import { build, parseArgs } from "../setup.ts";
import { ingest } from "./ingest.ts";
import { allChunks } from "./sources.ts";

const o = parseArgs(process.argv.slice(2));
const p = await build({ ...o, offline: true });
try {
  const counts = await ingest(p.store, p.embeddings, await allChunks(p.data, systemClock().today()));
  console.log(`indexado em ${p.store.name} com embeddings ${o.embed}:`, counts);
} finally {
  await p.data.close?.();
  await p.store.close?.();
}
