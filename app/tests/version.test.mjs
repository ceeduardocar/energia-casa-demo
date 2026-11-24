import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("version.js define versao semantica e data", () => {
  const s = read("version.js");
  assert.match(s, /APP_VERSION = "\d+\.\d+\.\d+"/);
  assert.match(s, /APP_DATE = "\d{4}-\d{2}-\d{2}"/);
});

test("index.html carrega version.js antes do app e o sw usa a mesma versao", () => {
  const html = read("index.html"), sw = read("sw.js");
  assert.ok(html.indexOf("version.js") > -1 && html.indexOf("version.js") < html.indexOf("app.js"));
  assert.match(sw, /importScripts\("version\.js"\)/);
  assert.match(sw, /SHELL = \["version\.js"/);
});
