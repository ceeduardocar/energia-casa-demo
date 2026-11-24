// Monta o assistente: roteador, experts, ferramentas, RAG, checagem de números e registro.
import { randomUUID } from "node:crypto";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Embeddings } from "@langchain/core/embeddings";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { dow } from "../../app/util.js";
import type { Clock } from "./clock.ts";
import type { DataProvider } from "./data/provider.ts";
import type { VectorStore } from "./rag/store.ts";
import { rotear, type ExpertName } from "./router.ts";
import { EXPERT_DEFS, systemPrompt } from "./experts/definitions.ts";
import { runExpert } from "./experts/loop.ts";
import { diasTools } from "./tools/dias.ts";
import { creditosTool } from "./tools/creditos.ts";
import { coletaTool } from "./tools/coleta.ts";
import { buscarTool } from "./tools/buscar.ts";
import { checkNumbers } from "./grounding.ts";
import type { Logger, Recuperado, Registro } from "./obs/log.ts";

export type AssistantDeps = {
  model: BaseChatModel; modelName: string;
  data: DataProvider; store: VectorStore; embeddings: Embeddings;
  clock: Clock; logger?: Logger; now?: () => string;
};

export type Resposta = Registro;

export function createAssistant(deps: AssistantDeps) {
  const dataTools = [...diasTools(deps.data), creditosTool(deps.data), coletaTool(deps.data, deps.now)];

  function toolsFor(expert: ExpertName, recuperados: Recuperado[]): StructuredToolInterface[] {
    const def = EXPERT_DEFS[expert];
    const rag = buscarTool({
      store: deps.store, embeddings: deps.embeddings,
      onHits: (consulta, hits) => recuperados.push(...hits.map(h => ({ consulta, colecao: h.colecao, caminho: h.caminho, titulo: h.titulo, score: Math.round(h.score * 1000) / 1000 }))),
    }, def.colecoes);
    return [...dataTools, rag].filter(t => def.ferramentas.includes(t.name));
  }

  return {
    async ask(pergunta: string, opts: { expert?: ExpertName } = {}): Promise<Resposta> {
      const t0 = performance.now();
      const hoje = deps.clock.today();
      const reg: Registro = {
        id: randomUUID(), inicio: new Date().toISOString(), pergunta, hoje,
        modelo: deps.modelName, dados: deps.data.name, store: deps.store.name,
        rota: { expert: "", motivo: "", reserva: false, ms: 0 }, passos: [], recuperados: [],
        tokens: { entrada: 0, saida: 0, chamadas_llm: 0 }, checagem: { ok: true, verificados: 0, sem_fonte: [] },
        resposta: "", ms_total: 0,
      };
      try {
        const tr = performance.now();
        const rota = opts.expert ? { expert: opts.expert, motivo: "escolhido pelo usuário", reserva: false } : await rotear(deps.model, pergunta);
        reg.rota = { ...rota, ms: Math.round(performance.now() - tr) };
        const def = EXPERT_DEFS[rota.expert];
        const out = await runExpert({
          model: deps.model, tools: toolsFor(rota.expert, reg.recuperados),
          system: systemPrompt(def, hoje, dow(hoje)), pergunta,
        });
        reg.passos = out.passos;
        reg.tokens = { ...out.tokens, chamadas_llm: out.tokens.chamadas_llm + (opts.expert ? 0 : 1) };
        reg.resposta = out.resposta;
        reg.checagem = checkNumbers(out.resposta, [pergunta, hoje, out.resultados]);
      } catch (e) {
        reg.erro = e instanceof Error ? e.message : String(e);
        reg.resposta = "Não consegui responder agora: " + reg.erro;
      }
      reg.ms_total = Math.round(performance.now() - t0);
      await deps.logger?.write(reg);
      return reg;
    },
  };
}
