// Loop de ferramentas de um expert: o modelo pede ferramentas, o código executa e devolve, até a resposta final.
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { Passo } from "../obs/log.ts";

export type LoopResult = {
  resposta: string;
  passos: Passo[];
  resultados: unknown[];
  tokens: { entrada: number; saida: number; chamadas_llm: number };
  limite: boolean;
};

export const MAX_PASSOS = 6;

const text = (m: AIMessage) =>
  typeof m.content === "string" ? m.content : m.content.map(p => (typeof p === "string" ? p : "text" in p ? String(p.text) : "")).join("");

const parse = (s: string) => { try { return JSON.parse(s); } catch { return s; } };

export async function runExpert(opts: {
  model: BaseChatModel; tools: StructuredToolInterface[]; system: string; pergunta: string; maxPassos?: number;
}): Promise<LoopResult> {
  const { model, tools, system, pergunta } = opts;
  const max = opts.maxPassos ?? MAX_PASSOS;
  const byName = new Map(tools.map(t => [t.name, t]));
  if (!model.bindTools) throw new Error("o modelo não aceita ferramentas (bindTools)");
  const bound = model.bindTools(tools);
  const messages: BaseMessage[] = [new SystemMessage(system), new HumanMessage(pergunta)];
  const passos: Passo[] = [];
  const resultados: unknown[] = [];
  const tokens = { entrada: 0, saida: 0, chamadas_llm: 0 };

  for (let i = 0; i < max; i++) {
    const ai = (await bound.invoke(messages)) as AIMessage;
    tokens.chamadas_llm++;
    tokens.entrada += ai.usage_metadata?.input_tokens ?? 0;
    tokens.saida += ai.usage_metadata?.output_tokens ?? 0;
    messages.push(ai);
    const calls = ai.tool_calls ?? [];
    if (!calls.length) return { resposta: text(ai).trim(), passos, resultados, tokens, limite: false };
    for (const call of calls) {
      const t0 = performance.now();
      const t = byName.get(call.name);
      let out: string, ok = true, erro: string | undefined;
      if (!t) {
        ok = false; erro = `ferramenta desconhecida: ${call.name}`;
        out = JSON.stringify({ erro });
      } else {
        try {
          out = String(await t.invoke(call.args));
          const p = parse(out);
          if (p && typeof p === "object" && "erro" in p) { ok = false; erro = String((p as any).erro); }
          resultados.push({ ferramenta: call.name, args: call.args, resultado: p });
        } catch (e) {
          ok = false; erro = e instanceof Error ? e.message : String(e);
          out = JSON.stringify({ erro });
        }
      }
      passos.push({ ferramenta: call.name, args: call.args, ms: Math.round(performance.now() - t0), ok, erro, bytes: out.length });
      messages.push(new ToolMessage({ content: out, tool_call_id: call.id ?? `${call.name}-${i}`, name: call.name }));
    }
  }
  return {
    resposta: `Não consegui concluir a resposta em ${max} passos de ferramenta. Tente uma pergunta mais específica.`,
    passos, resultados, tokens, limite: true,
  };
}
