import { test } from "node:test";
import assert from "node:assert/strict";
import { createAssistant } from "../src/assistant.ts";
import { ScriptedChatModel, callTool, lastToolResult, say } from "../src/scripted-model.ts";
import { offlineResponder } from "../src/offline-policy.ts";
import { demoProvider } from "../src/data/demo.ts";
import { MemoryStore } from "../src/rag/store.ts";
import { HashEmbeddings } from "../src/rag/embeddings.ts";
import { ingest } from "../src/rag/ingest.ts";
import { allChunks } from "../src/rag/sources.ts";
import { fixedClock } from "../src/clock.ts";
import { memoryLogger } from "../src/obs/log.ts";

const HOJE = "2026-11-20";

async function montar(responder = offlineResponder, data = demoProvider()) {
  const store = new MemoryStore(), embeddings = new HashEmbeddings();
  await ingest(store, embeddings, await allChunks(data, HOJE));
  const logger = memoryLogger();
  const model = new ScriptedChatModel(responder);
  const a = createAssistant({ model, modelName: "scripted", data, store, embeddings, clock: fixedClock(HOJE), logger, now: () => "2026-11-20T15:00:00Z" });
  return { a, logger, model };
}

test("pergunta de consumo: roteia, compara com a média e registra tudo", async () => {
  const { a, logger } = await montar();
  const r = await a.ask("Por que ontem consumi mais que a média?");
  assert.equal(r.rota.expert, "consumo");
  assert.deepEqual(r.passos.map(p => p.ferramenta), ["comparar_periodo"]);
  assert.deepEqual(r.passos[0].args, { dia: "2026-11-19", dias_antes: 7 });
  assert.match(r.resposta, /boiler/);
  assert.equal(r.checagem.ok, true, JSON.stringify(r.checagem));
  assert.ok(r.checagem.verificados >= 4);
  assert.equal(logger.rows.length, 1);
  assert.equal(logger.rows[0].id, r.id);
  assert.equal(r.tokens.chamadas_llm, 3);
  assert.equal(r.hoje, HOJE);
});

test("pergunta da conta: ferramenta de créditos + RAG nas regras, com fonte citada", async () => {
  const { a } = await montar();
  const r = await a.ask("Por que a conta de setembro veio com 100 kWh se eu injetei mais do que consumi?");
  assert.equal(r.rota.expert, "creditos");
  assert.deepEqual(r.passos.map(p => p.ferramenta), ["creditos", "buscar_documentos"]);
  assert.match(r.resposta, /212 kWh/);
  assert.equal(r.recuperados[0].caminho, "agent/knowledge/regras-energia.md");
  assert.match(r.resposta, /regras-energia\.md/);
  assert.equal(r.checagem.ok, true, JSON.stringify(r.checagem));
});

test("pergunta de operação com Tuya atrasada: diagnóstico e busca da causa", async () => {
  const data = demoProvider({ status: [
    { source: "solarman", ok: true, started_at: "2026-11-20T14:58:00Z", age_minutes: 2 },
    { source: "tuya", ok: true, started_at: "2026-11-20T13:00:00Z", age_minutes: 120 },
  ] });
  const { a } = await montar(offlineResponder, data);
  const r = await a.ask("A coleta da Tuya está funcionando?");
  assert.equal(r.rota.expert, "operacao");
  assert.deepEqual(r.passos.map(p => p.ferramenta), ["status_coleta", "buscar_documentos"]);
  assert.match(r.resposta, /tuya: atrasada/);
  assert.equal(r.checagem.ok, true, JSON.stringify(r.checagem));
});

test("expert não recebe ferramenta de outro expert", async () => {
  const { a, model } = await montar();
  await a.ask("A coleta da Solarman está funcionando?");
  const expertTurn = model.calls.find(c => !c.tools.includes("rotear"))!;
  assert.deepEqual(expertTurn.tools.sort(), ["buscar_documentos", "status_coleta"]);
});

test("número inventado pelo modelo aparece na checagem", async () => {
  const { a } = await montar(({ messages, tools }) => {
    if (tools.includes("rotear")) return callTool("rotear", { expert: "consumo", motivo: "t" });
    return lastToolResult(messages) ? say("Ontem o ar gastou 99,9 kWh.") : callTool("resumo_dia", { dia: "2026-11-19" });
  });
  const r = await a.ask("quanto o ar gastou ontem?");
  assert.deepEqual(r.checagem.sem_fonte, ["99,9"]);
  assert.equal(r.checagem.ok, false);
});

test("erro inesperado vira resposta de erro e ainda é registrado", async () => {
  const { a, logger } = await montar(({ tools }) => {
    if (tools.includes("rotear")) throw new Error("rede fora");
    throw new Error("modelo fora");
  }, demoProvider());
  const r = await a.ask("quanto gastei?");
  assert.equal(r.rota.reserva, true);
  assert.match(r.erro!, /modelo fora/);
  assert.equal(logger.rows.length, 1);
});
