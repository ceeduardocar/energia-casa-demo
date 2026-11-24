// Gera .env.supabase (ignorado pelo git) a partir de .env.solarman e .env.tuya, com a senha
// da Solarman já em SHA-256, para `supabase secrets set --env-file .env.supabase`. Não imprime valores.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const readEnv = (file) => {
  const env = {};
  for (const line of readFileSync(new URL(file, root), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
};
const check = (env, file, need) => {
  const missing = need.filter((k) => !env[k]);
  if (missing.length) {
    console.error(`Faltam em ${file}: ` + missing.join(", "));
    process.exit(1);
  }
};

const solar = readEnv(".env.solarman");
check(solar, ".env.solarman", ["SOLARMAN_APP_ID", "SOLARMAN_APP_SECRET", "SOLARMAN_EMAIL", "SOLARMAN_PASSWORD"]);
const tuya = readEnv(".env.tuya");
check(tuya, ".env.tuya", ["TUYA_CLIENT_ID", "TUYA_SECRET"]);

const out = {
  SOLARMAN_APP_ID: solar.SOLARMAN_APP_ID,
  SOLARMAN_APP_SECRET: solar.SOLARMAN_APP_SECRET,
  SOLARMAN_EMAIL: solar.SOLARMAN_EMAIL,
  SOLARMAN_PASSWORD_SHA256: createHash("sha256").update(solar.SOLARMAN_PASSWORD).digest("hex"),
  TUYA_CLIENT_ID: tuya.TUYA_CLIENT_ID,
  TUYA_SECRET: tuya.TUYA_SECRET,
  TUYA_BASE: tuya.TUYA_BASE || "https://openapi.tuyaus.com",
};
writeFileSync(new URL(".env.supabase", root), Object.entries(out).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
console.log("Gerado .env.supabase com: " + Object.keys(out).join(", "));
