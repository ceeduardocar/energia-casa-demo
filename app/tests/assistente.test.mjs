import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assistenteHtml, paragrafos } from "../assistente.js";
import { EXEMPLOS } from "../assistente-exemplos.js";
import { buildExemplos, render } from "../../scripts/assistente-exemplos.mjs";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const json = (f) => JSON.parse(readFileSync(new URL(`../../${f}`, import.meta.url), "utf8"));
const ui = { header: (s, t, _st, back, pill) => `<h1>${t}</h1>${back}${pill}`, tabbar: (on) => `<nav>${on}</nav>` };

test("exemplos gravados batem com a rodada da avaliação (gerados, não editados à mão)", () => {
  const origem = "agent/eval/results/gemini-2026-11-23.json";
  const esperado = render(buildExemplos(json(origem), json("agent/eval/dataset.json")), origem);
  assert.equal(read("assistente-exemplos.js"), esperado, "rode: node scripts/assistente-exemplos.mjs");
  assert.equal(EXEMPLOS.itens.length, 10);
  for (const i of EXEMPLOS.itens) {
    assert.ok(i.pergunta && i.resposta && i.expert, i.id);
    assert.ok(i.passos.length > 0, `${i.id} sem ferramentas`);
  }
});

test("tela avisa que são respostas de exemplo e não chama IA nem banco", () => {
  const html = assistenteHtml(null, ui);
  assert.match(html, /Respostas de exemplo/);
  assert.match(html, /não envia nada a uma IA nem a um banco/);
  for (const i of EXEMPLOS.itens) assert.ok(html.includes(i.pergunta.replace(/'/g, "&#39;")), i.id);
  for (const f of ["assistente.js", "assistente-exemplos.js"]) {
    assert.doesNotMatch(read(f), /\bfetch\(|XMLHttpRequest|WebSocket|https?:\/\//, f);
  }
});

test("pergunta escolhida mostra resposta, expert, ferramentas e checagem", () => {
  const html = assistenteHtml("creditos-minimo", ui);
  assert.match(html, /mínimo faturado não pode ser abatido/);
  assert.match(html, /expert Créditos/);
  assert.match(html, /<code>creditos<\/code>/);
  assert.match(html, /<code>buscar_documentos<\/code>\(consulta: /);
  assert.match(html, /números da resposta conferidos/);
  assert.match(html, /data-ask="creditos-minimo" aria-current="true"/);
  assert.match(assistenteHtml("operacao-tuya-atrasada", ui), /Cenário simulado: Solarman com última coleta há 2 min, Tuya com última coleta há 120 min/);
});

test("texto do modelo é escapado antes de virar HTML", () => {
  assert.equal(paragrafos("a <b>x</b> `power_signed_w`\n\nb"), "<p>a &lt;b&gt;x&lt;/b&gt; <code>power_signed_w</code></p><p>b</p>");
});

test("service worker guarda a tela do assistente para abrir offline", () => {
  const sw = read("sw.js");
  assert.match(sw, /"assistente\.js"/);
  assert.match(sw, /"assistente-exemplos\.js"/);
});
