import { test } from "node:test";
import assert from "node:assert/strict";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ScriptedChatModel, callTool, lastToolResult, say } from "../src/scripted-model.ts";
import { runExpert } from "../src/experts/loop.ts";

const soma = tool(async ({ a, b }) => JSON.stringify({ total: a + b, fonte: "teste" }), { name: "soma", description: "soma", schema: z.object({ a: z.number(), b: z.number() }) });
const quebra = tool(async () => { throw new Error("banco fora"); }, { name: "quebra", description: "falha", schema: z.object({}) });

test("chama a ferramenta, devolve o resultado ao modelo e termina com a resposta", async () => {
  const m = new ScriptedChatModel(({ messages }) => {
    const r = lastToolResult(messages, "soma");
    return r ? say(`Total ${r.total}. Fontes: soma`) : callTool("soma", { a: 2, b: 3 });
  });
  const out = await runExpert({ model: m, tools: [soma], system: "s", pergunta: "2+3?" });
  assert.equal(out.resposta, "Total 5. Fontes: soma");
  assert.equal(out.passos.length, 1);
  assert.equal(out.passos[0].ferramenta, "soma");
  assert.equal(out.passos[0].ok, true);
  assert.deepEqual(out.resultados, [{ ferramenta: "soma", args: { a: 2, b: 3 }, resultado: { total: 5, fonte: "teste" } }]);
  assert.deepEqual(out.tokens, { entrada: 300, saida: 60, chamadas_llm: 2 });
  assert.deepEqual(m.calls[0].tools, ["soma"]);
});

test("erro da ferramenta vira resultado { erro } e o modelo continua", async () => {
  const m = new ScriptedChatModel(({ messages }) => (lastToolResult(messages) ? say("A fonte está fora.") : callTool("quebra")));
  const out = await runExpert({ model: m, tools: [quebra], system: "s", pergunta: "?" });
  assert.equal(out.passos[0].ok, false);
  assert.equal(out.passos[0].erro, "banco fora");
  assert.equal(out.resposta, "A fonte está fora.");
});

test("ferramenta desconhecida é registrada como erro", async () => {
  const m = new ScriptedChatModel(({ messages }) => (lastToolResult(messages) ? say("ok") : callTool("inventada")));
  const out = await runExpert({ model: m, tools: [soma], system: "s", pergunta: "?" });
  assert.equal(out.passos[0].erro, "ferramenta desconhecida: inventada");
});

test("limite de passos encerra o loop", async () => {
  const m = new ScriptedChatModel(() => callTool("soma", { a: 1, b: 1 }));
  const out = await runExpert({ model: m, tools: [soma], system: "s", pergunta: "?", maxPassos: 3 });
  assert.equal(out.limite, true);
  assert.equal(out.passos.length, 3);
  assert.match(out.resposta, /3 passos/);
});
