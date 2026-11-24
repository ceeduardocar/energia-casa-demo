import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("o app não depende de CDN, Google Fonts nem biblioteca externa para abrir", () => {
  for (const f of ["index.html", "styles.css", "app.js", "supa.js", "house-view.js", "sw.js"]) {
    assert.doesNotMatch(read(f), /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/, f);
  }
});
test("o service worker guarda fonte, biblioteca e imagem da casa no cache do app", () => {
  const sw = read("sw.js");
  for (const f of ["fonts/manrope-latin-wght.woff2", "vendor/supabase.umd.js", "assets/casa-noite.webp"]) assert.ok(sw.includes(f), f);
  assert.match(sw, /u\.origin !== location\.origin\) return/);
});
test("nenhum texto abaixo de 12 px na folha de estilo", () => {
  assert.doesNotMatch(read("styles.css"), /font-size:\s*1[01](\.\d+)?px/);
});
test("o modo 2D da Casa foi retirado", () => {
  const h = read("house-view.js"), c = read("styles.css");
  assert.doesNotMatch(h, /floorPlan|data-house-mode|2d/i);
  assert.doesNotMatch(c, /hv-plan|hv-view--2d|hv-mode/);
});
test("o Início usa uma única chamada ao banco", () => {
  const a = read("app.js"), i = a.indexOf("async function withHome"), j = a.indexOf("const viewInicio");
  assert.match(a.slice(i, j), /api\.fetchHome\(/);
  assert.doesNotMatch(a.slice(i, j), /fetchNow|fetchHourly|fetchEvents|fetchOpenPool|fetchSelfConsumption/);
});
test("get_home devolve as seis chaves que o app lê", () => {
  const s = read("supa.js");
  for (const k of ["now", "status", "hourly", "self", "car", "pool"]) assert.match(s, new RegExp(`\\b${k}: `));
});
