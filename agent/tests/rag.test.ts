import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkMarkdown, splitLong } from "../src/rag/chunk.ts";
import { HashEmbeddings, cosine } from "../src/rag/embeddings.ts";
import { MemoryStore, bm25Scores, COLECOES } from "../src/rag/store.ts";
import { ingest } from "../src/rag/ingest.ts";
import { allChunks, billChunks, billText } from "../src/rag/sources.ts";
import { buscar } from "../src/tools/buscar.ts";
import { demoProvider } from "../src/data/demo.ts";
import { tokens } from "../src/rag/text.ts";

test("chunkMarkdown guarda o caminho dos títulos e ignora # dentro de bloco de código", () => {
  const md = "# A\nintro\n## B\ntexto b\n```\n# não é título\n```\n### C\ntexto c\n## D\ntexto d";
  const cs = chunkMarkdown(md, "x.md", "ProjetoDocs");
  assert.deepEqual(cs.map(c => c.titulo), ["A", "A > B", "A > B > C", "A > D"]);
  assert.match(cs[1].texto, /# não é título/);
  assert.equal(cs[0].caminho, "x.md");
});

test("splitLong respeita o limite e repete a última frase curta", () => {
  const t = Array.from({ length: 30 }, (_, i) => `Frase número ${i} com algum texto.`).join(" ");
  const parts = splitLong(t, 200);
  assert.ok(parts.length > 3);
  assert.ok(parts.every(p => p.length <= 200 + 40));
  const lastOfFirst = parts[0].split(". ").pop()!;
  assert.ok(parts[1].startsWith(lastOfFirst.replace(/\.$/, "")));
});

test("tokens tira acento, caixa e palavras vazias", () => {
  assert.deepEqual(tokens("O Mínimo faturado da CONTA"), ["minimo", "faturado", "conta"]);
});

test("HashEmbeddings é determinístico e aproxima textos com as mesmas palavras", async () => {
  const e = new HashEmbeddings();
  const a = await e.embedQuery("mínimo faturado de 100 kWh");
  assert.deepEqual(a, await e.embedQuery("mínimo faturado de 100 kWh"));
  const perto = cosine(a, await e.embedQuery("o mínimo faturado na conta trifásica"));
  const longe = cosine(a, await e.embedQuery("token da solarman venceu"));
  assert.ok(perto > longe);
});

test("bm25 pontua mais o documento com o termo raro", () => {
  const s = bm25Scores([["casa", "energia"], ["itaipu", "bonus"], ["casa"]], ["itaipu"]);
  assert.ok(s[1] > 0 && s[0] === 0 && s[2] === 0);
});

test("MemoryStore.hybrid filtra por coleção e ordena pela fusão", async () => {
  const st = new MemoryStore(), e = new HashEmbeddings();
  const docs = [
    { colecao: "RegrasEnergia", titulo: "Mínimo faturado", caminho: "r.md", texto: "O mínimo faturado da ligação trifásica é 100 kWh." },
    { colecao: "RegrasEnergia", titulo: "Bandeira", caminho: "r.md", texto: "A bandeira amarela é um acréscimo por kWh." },
    { colecao: "Contas", titulo: "Conta", caminho: "c.json", texto: "Consumo faturado 100 kWh, mínimo." },
  ];
  await st.add(await Promise.all(docs.map(async d => ({ ...d, vector: await e.embedQuery(d.texto) }))));
  const q = "por que o mínimo faturado";
  const hits = await st.hybrid(["RegrasEnergia"], q, await e.embedQuery(q), 2, 0.5);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].titulo, "Mínimo faturado");
  assert.ok(hits.every(h => h.colecao === "RegrasEnergia"));
});

test("contas viram texto sem nome, CPF ou endereço", async () => {
  const cs = await billChunks();
  assert.equal(cs.length, 5);
  for (const c of cs) assert.doesNotMatch(c.texto, /CPF|CNPJ|Rua|Quadra|SHIS|QL /i);
  assert.match(billText({ ref_month: "2026-09", kwh_billed: 100 }), /Consumo faturado 100 kWh/);
});

test("ingestão indexa as quatro coleções e a busca acha a regra do mínimo faturado", async () => {
  const st = new MemoryStore(), e = new HashEmbeddings();
  const counts = await ingest(st, e, await allChunks(demoProvider(), "2026-11-20"));
  for (const c of COLECOES) assert.ok(counts[c] > 0, `${c} vazia`);
  assert.equal(counts.ResumoDiario, 30);
  const hits = await buscar({ store: st, embeddings: e }, ["RegrasEnergia"], "por que a conta vem com 100 kWh de mínimo faturado");
  assert.equal(hits[0].caminho, "agent/knowledge/regras-energia.md");
  assert.match(hits[0].titulo, /Mínimo faturado/);
});

test("busca de operação acha a janela da Solarman", async () => {
  const st = new MemoryStore(), e = new HashEmbeddings();
  await ingest(st, e, await allChunks(demoProvider(), "2026-11-20"));
  const hits = await buscar({ store: st, embeddings: e }, ["RegrasEnergia", "ProjetoDocs"], "solarman pausa noturna janela de coleta");
  assert.ok(hits.some(h => /Pausa noturna/i.test(h.texto)));
});
