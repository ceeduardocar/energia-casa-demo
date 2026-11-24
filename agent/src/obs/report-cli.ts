// Relatório de observabilidade.
//   node src/obs/report-cli.ts                    todos os arquivos de agent/logs/
//   node src/obs/report-cli.ts arquivo.jsonl      um arquivo de log ou um resultado da avaliação
//   node src/obs/report-cli.ts --json ...         métricas em JSON (para painel ou outra ferramenta)
import { readdir, readFile } from "node:fs/promises";
import { LOG_DIR } from "./log.ts";
import { parseRecords, summarize, toMarkdown } from "./report.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
let files = args.filter(a => a !== "--json");
if (!files.length) files = (await readdir(LOG_DIR).catch(() => [])).filter(f => f.endsWith(".jsonl")).map(f => LOG_DIR + f);
if (!files.length) {
  console.error("nenhum registro: faça uma pergunta (npm run ask) ou passe um arquivo");
  process.exit(2);
}
const rows = (await Promise.all(files.map(async f => parseRecords(await readFile(f, "utf8"))))).flat();
const s = summarize(rows);
console.log(json ? JSON.stringify(s, null, 2) : toMarkdown(s));
