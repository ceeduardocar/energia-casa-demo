import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecords, summarize, toMarkdown } from "../src/obs/report.ts";
import type { Registro } from "../src/obs/log.ts";

const reg = (p: Partial<Registro>): Registro => ({
  id: "x", inicio: "2026-11-23T12:00:00Z", pergunta: "?", hoje: "2026-11-20", modelo: "m", dados: "demo", store: "memory",
  rota: { expert: "consumo", motivo: "", reserva: false, ms: 1 }, passos: [], recuperados: [],
  tokens: { entrada: 100, saida: 20, chamadas_llm: 2 }, checagem: { ok: true, verificados: 3, sem_fonte: [] },
  resposta: "", ms_total: 100, ...p,
});

test("summarize soma tokens, conta experts e separa números sem fonte", () => {
  const s = summarize([
    reg({ id: "a", ms_total: 100, passos: [{ ferramenta: "resumo_dia", args: {}, ms: 5, ok: true, bytes: 10 }] }),
    reg({ id: "b", ms_total: 300, rota: { expert: "creditos", motivo: "", reserva: true, ms: 1 },
      passos: [{ ferramenta: "creditos", args: {}, ms: 7, ok: false, erro: "x", bytes: 3 }],
      recuperados: [{ consulta: "q", colecao: "RegrasEnergia", caminho: "r.md", titulo: "t", score: 1 }],
      checagem: { ok: false, verificados: 2, sem_fonte: ["9,9"] } }),
  ]);
  assert.deepEqual(s.por_expert, { consumo: 1, creditos: 1 });
  assert.equal(s.roteamento_por_reserva, 1);
  assert.deepEqual(s.latencia_ms, { media: 200, p50: 100, p95: 300, max: 300 });
  assert.equal(s.tokens.entrada, 200);
  assert.equal(s.tokens.media_por_pergunta, 120);
  assert.equal(s.ferramentas.com_erro, 1);
  assert.deepEqual(s.rag.por_colecao, { RegrasEnergia: 1 });
  assert.equal(s.numeros.verificados, 5);
  assert.deepEqual(s.numeros.sem_fonte, [{ id: "b", pergunta: "?", numeros: ["9,9"] }]);
  assert.match(toMarkdown(s), /Perguntas com número sem fonte \| 1/);
});

test("parseRecords lê JSONL e o resultado da avaliação", () => {
  const a = reg({ id: "a" }), b = reg({ id: "b" });
  assert.deepEqual(parseRecords(`${JSON.stringify(a)}\n${JSON.stringify(b)}\n`).map(r => r.id), ["a", "b"]);
  assert.deepEqual(parseRecords(JSON.stringify({ registros: [a] }, null, 2)).map(r => r.id), ["a"]);
  assert.deepEqual(parseRecords(""), []);
});

test("sem registros: métricas zeradas", () => {
  const s = summarize([]);
  assert.equal(s.perguntas, 0);
  assert.equal(s.periodo, null);
  assert.equal(s.latencia_ms.max, 0);
});
