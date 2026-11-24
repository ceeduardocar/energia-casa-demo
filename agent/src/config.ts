// Configuração por variáveis de ambiente, com agent/.env opcional (nunca versionado).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ENV = fileURLToPath(new URL("../.env", import.meta.url));

export function loadEnv() {
  if (existsSync(ENV)) process.loadEnvFile(ENV);
}

export const config = () => ({
  geminiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
  model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
  databaseUrl: process.env.DATABASE_URL || "",
});
