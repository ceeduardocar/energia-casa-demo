// Teste de conexao com a Solarman OpenAPI (somente leitura, roda so no seu PC).
// Le as chaves de .env.solarman (ignorado pelo git), pede o token e mostra as plantas
// com a geracao atual. Nunca imprime o token nem as chaves.
// Uso: node scripts/solarman-check.mjs   (gasta 2 chamadas + 2 por planta da cota anual)
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const BASE = "https://globalapi.solarmanpv.com";
const ENV_FILE = new URL("../.env.solarman", import.meta.url);

function loadEnv() {
  let text;
  try { text = readFileSync(ENV_FILE, "utf8"); }
  catch { throw new Error("Arquivo .env.solarman nao encontrado na raiz do repo."); }
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const need = ["SOLARMAN_APP_ID", "SOLARMAN_APP_SECRET", "SOLARMAN_EMAIL", "SOLARMAN_PASSWORD"];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) throw new Error("Faltam em .env.solarman: " + missing.join(", "));
  return env;
}

async function call(path, body, token) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token && { Authorization: "bearer " + token }) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(`${path.split("?")[0]}: HTTP ${res.status} code=${data.code ?? "-"} msg=${data.msg ?? "-"}`);
  }
  return data;
}

const env = loadEnv();
const password = createHash("sha256").update(env.SOLARMAN_PASSWORD).digest("hex"); // hex ja sai minusculo

const auth = await call(
  `/account/v1.0/token?appId=${encodeURIComponent(env.SOLARMAN_APP_ID)}&language=en`,
  { appSecret: env.SOLARMAN_APP_SECRET, email: env.SOLARMAN_EMAIL, password },
);
const token = auth.access_token;
const days = auth.expires_in ? (Number(auth.expires_in) / 86400).toFixed(0) : "?";
console.log(`Token OK (validade ~${days} dias).`);

const list = await call("/station/v1.0/list?language=en", { page: 1, size: 20 }, token);
const stations = list.stationList ?? [];
console.log(`Plantas: ${stations.length}`);

for (const s of stations) {
  console.log(`\n- ${s.name}  (stationId ${s.id})`);
  const rt = await call("/station/v1.0/realTime?language=en", { stationId: s.id }, token);
  const when = rt.lastUpdateTime ? new Date(rt.lastUpdateTime * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "?";
  console.log(`  agora: ${rt.generationPower ?? "?"} W | hoje: ${rt.generationValue ?? "?"} kWh | total: ${rt.generationTotal ?? "?"} kWh | atualizado: ${when}`);
  const dev = await call("/station/v1.0/device?language=en", { stationId: s.id }, token);
  for (const d of dev.deviceListItems ?? []) {
    console.log(`  aparelho: ${d.deviceType} ${d.deviceSn} (deviceId ${d.deviceId}) estado=${d.connectStatus}`);
  }
}
