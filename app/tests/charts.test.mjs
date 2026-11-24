import test from "node:test";
import assert from "node:assert/strict";
import { stackedHourly } from "../charts.js";

test("gráfico empilhado preserva as cores e torna valor pequeno visível", () => {
  const values = (at, value) => Array.from({ length: 24 }, (_, i) => i === at ? value : null);
  const html = stackedHourly({
    stacks: [
      { values: values(10, 4.96), color: "#8FA9BC" },
      { values: values(10, 0.01), color: "#A78BFA" },
      { values: values(10, 0.02), color: "#F472B6" },
    ],
    nowIdx: 10,
    label: "Consumo por equipamento",
    names: ["Outros", "Ar-cond.", "Boiler"],
  });
  assert.match(html, /fill="#8FA9BC"/);
  assert.match(html, /fill="#A78BFA"/);
  assert.match(html, /fill="#F472B6"/);
  assert.match(html, /height="1\.0" fill="#A78BFA"/);
  assert.match(html, /Ar-cond\. 0,01 kWh/);
});
