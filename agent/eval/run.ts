// Avaliação do assistente sobre eval/dataset.json.
//   node eval/run.ts --offline   modelo roteirizado, sem rede (CI); falha se algum critério falhar
//   node eval/run.ts             Gemini de verdade (precisa de GEMINI_API_KEY); grava o resultado, não falha
// Critérios por pergunta: expert, ferramentas (todas as esperadas foram chamadas), números esperados presentes,
// palavras esperadas, documento esperado entre os recuperados e checagem de números sem fonte.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { relative, resolve } from "node:path";
import { createAssistant, type Resposta } from "../src/assistant.ts";
import { fixedClock } from "../src/clock.ts";
import { demoProvider } from "../src/data/demo.ts";
import { numbersInText, parsePt } from "../src/grounding.ts";
import { memoryLogger } from "../src/obs/log.ts";
import { ingest } from "../src/rag/ingest.ts";
import { allChunks } from "../src/rag/sources.ts";
import { MemoryStore } from "../src/rag/store.ts";
import { MissingKeyError, build, parseArgs } from "../src/setup.ts";
import { normalize } from "../src/rag/text.ts";

type Item = {
  id: string; pergunta: string; expert: string[]; ferramentas: string[];
  numeros?: number[]; palavras?: string[]; documento?: string; offline?: boolean;
  cenario?: { status?: any[]; agora?: string };
};

const DIR = fileURLToPath(new URL("./", import.meta.url));

export function hasNumber(answer: string, expected: number) {
  return numbersInText(answer).some(raw => {
    const { value, decimals } = parsePt(raw);
    return Math.abs(Math.abs(value) - Math.abs(expected)) <= 0.5 * 10 ** -decimals + 1e-9;
  });
}

export function score(item: Item, r: Resposta) {
  const chamadas = new Set(r.passos.map(p => p.ferramenta));
  const c = {
    expert: item.expert.includes(r.rota.expert),
    ferramentas: item.ferramentas.every(f => chamadas.has(f)),
    numeros: (item.numeros ?? []).every(n => hasNumber(r.resposta, n)),
    palavras: (item.palavras ?? []).every(w => normalize(r.resposta).includes(normalize(w))),
    documento: !item.documento || r.recuperados.some(h => h.caminho === item.documento),
    sem_alucinacao: r.checagem.ok,
    sem_erro: !r.erro,
  };
  return { ...c, ok: Object.values(c).every(Boolean) };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const ds = JSON.parse(await readFile(`${DIR}dataset.json`, "utf8"));
  const itens: Item[] = ds.itens.filter((i: Item) => !o.offline || i.offline !== false);
  const base = await build({ ...o, data: "demo", store: "memory" });
  const store = new MemoryStore();
  await ingest(store, base.embeddings, await allChunks(demoProvider(), ds.hoje));
  const logger = memoryLogger();
  const linhas = [];
  for (const item of itens) {
    const a = createAssistant({
      model: base.model, modelName: base.modelName, embeddings: base.embeddings, store,
      data: demoProvider({ status: item.cenario?.status }), clock: fixedClock(ds.hoje),
      now: () => item.cenario?.agora ?? ds.agora, logger,
    });
    const r = await a.ask(item.pergunta);
    const s = score(item, r);
    // Os critérios (booleanos) vêm por último: expert e ferramentas não podem ser sobrescritos pelo que foi usado.
    linhas.push({ id: item.id, expert_usado: r.rota.expert, ferramentas_usadas: r.passos.map(p => p.ferramenta), ...s, sem_fonte: r.checagem.sem_fonte, erro: r.erro, ms: r.ms_total, tokens: r.tokens, resposta: r.resposta });
    console.log(`${s.ok ? "ok  " : "FAIL"} ${item.id}${s.ok ? "" : "  " + Object.entries(s).filter(([k, v]) => !v && k !== "ok").map(([k]) => k).join(", ")}${r.erro ? "\n     erro: " + r.erro.slice(0, 300) : ""}`);
  }
  const crit = ["expert", "ferramentas", "numeros", "palavras", "documento", "sem_alucinacao", "sem_erro"] as const;
  const resumo = Object.fromEntries(crit.map(k => [k, `${linhas.filter(l => (l as any)[k]).length}/${linhas.length}`]));
  const out = {
    modo: o.offline ? "offline (modelo roteirizado)" : `gemini (${base.modelName})`, embeddings: o.embed,
    gerado_em: new Date().toISOString(), hoje: ds.hoje, perguntas: linhas.length,
    acertos: linhas.filter(l => l.ok).length, resumo, itens: linhas, registros: logger.rows,
  };
  await mkdir(`${DIR}results`, { recursive: true });
  const file = `${DIR}results/${o.offline ? "offline" : "gemini"}-${new Date().toISOString().slice(0, 10)}.json`;
  await writeFile(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`\n${out.acertos}/${out.perguntas} perguntas ok · ${JSON.stringify(resumo)}\nresultado: ${relative(process.cwd(), file)}`);
  if (o.offline && out.acertos < out.perguntas) process.exit(1);
}

// pathToFileURL: no Windows e em caminhos com espaço a URL do módulo não é "file://" + argv[1].
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(e => { console.error(e instanceof MissingKeyError ? e.message : e); process.exit(1); });
}
