// Teste de conexao com a Tuya Cloud (somente leitura, roda so no seu PC).
// Le as chaves de .env.tuya (ignorado pelo git), pede o token e mostra, para cada
// aparelho de TUYA_DEVICE_IDS: se esta online, o modelo, os codigos de data point
// atuais (status) e os codigos que o aparelho suporta (specifications).
// Nunca imprime o secret nem o token.
// Uso: node scripts/tuya-check.mjs
// .env.tuya (exemplo):
//   TUYA_CLIENT_ID=...
//   TUYA_SECRET=...
//   TUYA_DEVICE_IDS=id_medidor_rede,id_medidor_aparelhos
//   TUYA_BASE=https://openapi.tuyaus.com   (o data center do projeto Tuya; opcional)
import { readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";

const ENV_FILE = new URL("../.env.tuya", import.meta.url);
const DEFAULT_BASE = "https://openapi.tuyaus.com";

const sha256hex = (text) => createHash("sha256").update(text ?? "").digest("hex");

function loadEnv() {
  let text;
  try { text = readFileSync(ENV_FILE, "utf8"); }
  catch { throw new Error("Arquivo .env.tuya nao encontrado na raiz do repo."); }
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const need = ["TUYA_CLIENT_ID", "TUYA_SECRET", "TUYA_DEVICE_IDS"];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) throw new Error("Faltam em .env.tuya: " + missing.join(", "));
  env.TUYA_BASE ??= DEFAULT_BASE;
  env.TUYA_DEVICE_IDS = env.TUYA_DEVICE_IDS.split(",").map((s) => s.trim()).filter(Boolean);
  return env;
}

// Assinatura Tuya OpenAPI (HMAC-SHA256): stringToSign = metodo + hash do corpo + cabecalhos vazios + caminho com query.
function signedHeaders(env, method, pathWithQuery, token) {
  const t = Date.now().toString();
  const stringToSign = [method, sha256hex(""), "", pathWithQuery].join("\n");
  const sign = createHmac("sha256", env.TUYA_SECRET)
    .update(env.TUYA_CLIENT_ID + (token ?? "") + t + stringToSign)
    .digest("hex")
    .toUpperCase();
  return {
    client_id: env.TUYA_CLIENT_ID,
    sign,
    t,
    sign_method: "HMAC-SHA256",
    ...(token && { access_token: token }),
  };
}

async function call(env, path, token) {
  const res = await fetch(env.TUYA_BASE + path, {
    method: "GET",
    headers: signedHeaders(env, "GET", path, token),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(`${path.split("?")[0]}: HTTP ${res.status} code=${data.code ?? "-"} msg=${data.msg ?? "-"}`);
  }
  return data.result;
}

const env = loadEnv();
const { access_token: token, expire_time: expire } = await call(env, "/v1.0/token?grant_type=1");
console.log(`Token OK (validade ~${Math.round((expire ?? 0) / 60)} min).`);

for (const id of env.TUYA_DEVICE_IDS) {
  const info = await call(env, `/v1.0/devices/${id}`, token);
  console.log(`\n- ${info.name}  (id ${id})`);
  console.log(`  modelo: ${info.product_name ?? "?"} | categoria: ${info.category ?? "?"} | online: ${info.online}`);

  const status = await call(env, `/v1.0/devices/${id}/status`, token);
  console.log("  status atual:");
  for (const { code, value } of status) console.log(`    ${code} = ${JSON.stringify(value)}`);

  const specs = await call(env, `/v1.0/devices/${id}/specifications`, token);
  console.log("  codigos suportados (tipo, unidade, escala):");
  for (const s of specs.status ?? []) {
    const v = typeof s.values === "string" ? JSON.parse(s.values || "{}") : (s.values ?? {});
    const extra = [v.unit && `unidade=${v.unit}`, v.scale !== undefined && `escala=${v.scale}`].filter(Boolean).join(" ");
    console.log(`    ${s.code} (${s.type}) ${extra}`);
  }
}
