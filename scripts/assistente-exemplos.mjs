// Gera app/assistente-exemplos.js a partir de uma rodada gravada da avaliação do assistente
// (agent/eval/results/<arquivo>.json + as perguntas de agent/eval/dataset.json).
// A tela "Assistente" do app mostra só essas respostas gravadas: não chama LLM nem banco.
// Uso: node scripts/assistente-exemplos.mjs [agent/eval/results/gemini-2026-11-23.json]
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));

// Perguntas de operação rodam sobre um status de coleta simulado: a tela explica qual.
const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
function cenarioTexto(c) {
  if (!c?.status) return "";
  const fontes = c.status.map((s) => `${s.source === "tuya" ? "Tuya" : "Solarman"} com última coleta há ${s.age_minutes} min`).join(", ");
  return `Cenário simulado${c.agora ? ` às ${hora(c.agora)} (Brasília)` : ""}: ${fontes}.`;
}

export function buildExemplos(result, dataset) {
  const ds = Object.fromEntries(dataset.itens.map((i) => [i.id, i]));
  const perguntas = Object.fromEntries(dataset.itens.map((i) => [i.id, i.pergunta]));
  const regs = Object.fromEntries((result.registros || []).map((r) => [r.pergunta, r]));
  return {
    modelo: result.modo,
    gerado_em: result.gerado_em,
    hoje: result.hoje,
    acertos: `${result.acertos}/${result.perguntas}`,
    itens: result.itens.map((it) => {
      const pergunta = perguntas[it.id];
      if (!pergunta) throw new Error(`pergunta sem id no dataset: ${it.id}`);
      const reg = regs[pergunta] || {};
      const [texto, fontes] = it.resposta.split(/\n+Fontes:\s*/);
      return {
        id: it.id,
        pergunta,
        resposta: texto.trim(),
        fontes: (fontes || "").replace(/\.$/, "").trim(),
        cenario: cenarioTexto(ds[it.id].cenario),
        expert: it.expert,
        motivo: reg.rota?.motivo || "",
        passos: (reg.passos || []).map((p) => ({ ferramenta: p.ferramenta, args: p.args, ok: p.ok })),
        documentos: [...new Map((reg.recuperados || []).map((d) => [d.caminho, { titulo: d.titulo, caminho: d.caminho, score: d.score }])).values()].slice(0, 3),
        recuperacao: reg.store || "",
        conferidos: reg.checagem?.verificados ?? null,
        ms: it.ms,
        chamadas_llm: it.tokens?.chamadas_llm ?? null,
        tokens: it.tokens ? it.tokens.entrada + it.tokens.saida : null,
        ok: it.ok,
      };
    }),
  };
}

export const render = (ex, origem) =>
  `// GERADO por scripts/assistente-exemplos.mjs a partir de ${origem}. Não edite à mão.\n` +
  `// Respostas reais do assistente (agent/) na avaliação, sobre os dados de exemplo. O app só exibe.\n` +
  `export const EXEMPLOS = ${JSON.stringify(ex, null, 1)};\n`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const origem = process.argv[2] || "agent/eval/results/gemini-2026-11-23.json";
  const ex = buildExemplos(read(origem), read("agent/eval/dataset.json"));
  writeFileSync(new URL("app/assistente-exemplos.js", root), render(ex, origem));
  console.log(`app/assistente-exemplos.js: ${ex.itens.length} respostas (${ex.modelo}, ${ex.acertos})`);
}
