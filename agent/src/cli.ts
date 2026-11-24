// Pergunta ao assistente pela linha de comando.
//   node src/cli.ts [--data demo|postgres] [--store memory|weaviate] [--embed hash|gemini] [--offline] [--expert nome] [--json] "pergunta"
import { createAssistant } from "./assistant.ts";
import { systemClock } from "./clock.ts";
import { fileLogger } from "./obs/log.ts";
import { ingest } from "./rag/ingest.ts";
import { allChunks } from "./rag/sources.ts";
import { COLECOES } from "./rag/store.ts";
import { EXPERTS, type ExpertName } from "./router.ts";
import { MissingKeyError, build, parseArgs } from "./setup.ts";

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const pergunta = o.rest.join(" ").trim();
  if (!pergunta) {
    console.error('uso: node src/cli.ts [--data demo|postgres] [--store memory|weaviate] [--embed hash|gemini] [--offline] "pergunta"');
    process.exit(2);
  }
  if (o.expert && !EXPERTS.includes(o.expert as ExpertName)) throw new Error(`--expert inválido: ${o.expert}`);
  const p = await build(o);
  const clock = systemClock();
  try {
    if (o.store === "memory") await ingest(p.store, p.embeddings, await allChunks(p.data, clock.today()));
    else if ((await Promise.all(COLECOES.map(c => p.store.count(c)))).some(n => n === 0))
      throw new Error("Weaviate sem índice: rode antes `npm run ingest -- --store weaviate` com as mesmas opções");
    const a = createAssistant({ ...p, clock, logger: fileLogger() });
    const r = await a.ask(pergunta, { expert: o.expert as ExpertName | undefined });
    if (o.json) { console.log(JSON.stringify(r, null, 2)); return; }
    console.log(r.resposta);
    console.log(`\n— expert ${r.rota.expert}${r.rota.reserva ? " (reserva)" : ""} · ferramentas: ${r.passos.map(x => x.ferramenta).join(", ") || "nenhuma"} · ` +
      `números ${r.checagem.ok ? "conferidos" : "SEM FONTE: " + r.checagem.sem_fonte.join(", ")} (${r.checagem.verificados}) · ${r.ms_total} ms · ` +
      `${r.tokens.entrada}+${r.tokens.saida} tokens`);
  } finally {
    await p.data.close?.();
    await p.store.close?.();
  }
}

main().catch(e => {
  console.error(e instanceof MissingKeyError ? e.message : e);
  process.exit(1);
});
