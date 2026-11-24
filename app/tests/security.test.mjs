import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const csp = () => JSON.parse(read("vercel.json")).headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;

test("CSP nao libera script inline, eval nem dominio de terceiros", () => {
  const script = /script-src ([^;]+)/.exec(csp())[1];
  assert.equal(script.trim(), "'self'");
  assert.match(csp(), /object-src 'none'/);
  assert.match(csp(), /frame-ancestors 'none'/);
});

test("index.html nao tem script inline (a CSP bloquearia)", () => {
  for (const m of read("index.html").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    assert.match(m[1], /\bsrc=/, "script sem src: " + m[0].slice(0, 60));
    assert.equal(m[2].trim(), "");
  }
});

test("leitor de PDF usa o pdf.js local, sem CDN e sem eval", () => {
  const s = read("billparse.js");
  assert.doesNotMatch(s, /https?:\/\//);
  assert.match(s, /vendor\/pdfjs\/pdf\.min\.mjs/);
  assert.match(s, /isEvalSupported: false/);
});
