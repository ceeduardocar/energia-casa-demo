// node src/obs/pg-export-cli.ts [arquivos...]   (DATABASE_URL do laboratório; sem arquivos, todos de agent/logs/)
import { readdir, readFile } from "node:fs/promises";
import { loadEnv, config } from "../config.ts";
import { LOG_DIR } from "./log.ts";
import { parseRecords } from "./report.ts";
import { exportRecords } from "./pg-export.ts";

loadEnv();
const url = config().databaseUrl;
if (!url) { console.error("DATABASE_URL ausente (Postgres do laboratório, nunca produção)"); process.exit(2); }
let files = process.argv.slice(2);
if (!files.length) files = (await readdir(LOG_DIR).catch(() => [])).filter(f => f.endsWith(".jsonl")).map(f => LOG_DIR + f);
const rows = (await Promise.all(files.map(async f => parseRecords(await readFile(f, "utf8"))))).flat();
const total = await exportRecords(url, rows);
console.log(`${rows.length} registros lidos; obs.perguntas tem ${total} linhas`);
