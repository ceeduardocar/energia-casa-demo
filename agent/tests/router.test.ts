import { test } from "node:test";
import assert from "node:assert/strict";
import { AIMessage } from "@langchain/core/messages";
import { ScriptedChatModel, callTool } from "../src/scripted-model.ts";
import { rotaPorPalavras, rotear } from "../src/router.ts";

test("roteador usa a saída estruturada do modelo", async () => {
  const m = new ScriptedChatModel(t => callTool(t.tools[0], { expert: "creditos", motivo: "fala de saldo" }));
  assert.deepEqual(await rotear(m, "quanto tenho?"), { expert: "creditos", motivo: "fala de saldo", reserva: false });
  assert.equal(m.calls[0].tools[0], "rotear");
});

test("modelo com erro: cai nas palavras-chave", async () => {
  const m = new ScriptedChatModel(() => { throw new Error("429 quota"); });
  assert.deepEqual(await rotear(m, "A coleta da Tuya está funcionando?"), { expert: "operacao", motivo: "palavras-chave", reserva: true });
});

test("modelo responde expert inválido: cai nas palavras-chave", async () => {
  const m = new ScriptedChatModel(t => callTool(t.tools[0], { expert: "piscina", motivo: "?" }));
  assert.equal((await rotear(m, "Quanto do saldo de créditos eu usei?")).expert, "creditos");
});

test("modelo responde sem ferramenta: cai nas palavras-chave", async () => {
  const m = new ScriptedChatModel(() => new AIMessage("consumo"));
  assert.equal((await rotear(m, "por que gastei mais ontem?")).reserva, true);
});

test("palavras-chave: operação antes de créditos, consumo como padrão", () => {
  assert.equal(rotaPorPalavras("a leitura da conta atrasou").expert, "operacao");
  assert.equal(rotaPorPalavras("Por que a fatura veio com 100 kWh?").expert, "creditos");
  assert.equal(rotaPorPalavras("Quanto o boiler gastou ontem?").expert, "consumo");
});
