// Monta as peças a partir das opções da linha de comando (CLI, ingestão e avaliação).
import type { Embeddings } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { config, loadEnv } from "./config.ts";
import { demoProvider } from "./data/demo.ts";
import { postgresProvider } from "./data/postgres.ts";
import type { DataProvider } from "./data/provider.ts";
import { HashEmbeddings, geminiEmbeddings } from "./rag/embeddings.ts";
import { MemoryStore, type VectorStore } from "./rag/store.ts";
import { weaviateStore } from "./rag/weaviate.ts";
import { geminiChat } from "./llm.ts";
import { ScriptedChatModel } from "./scripted-model.ts";
import { offlineResponder } from "./offline-policy.ts";

export type Options = { data: "demo" | "postgres"; store: "memory" | "weaviate"; embed: "hash" | "gemini"; offline: boolean; expert?: string; json: boolean; rest: string[] };

export function parseArgs(argv: string[]): Options {
  const o: Options = { data: "demo", store: "memory", embed: "hash", offline: false, json: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--data") o.data = argv[++i] as Options["data"];
    else if (a === "--store") o.store = argv[++i] as Options["store"];
    else if (a === "--embed") o.embed = argv[++i] as Options["embed"];
    else if (a === "--expert") o.expert = argv[++i];
    else if (a === "--offline") o.offline = true;
    else if (a === "--json") o.json = true;
    else o.rest.push(a);
  }
  if (!["demo", "postgres"].includes(o.data)) throw new Error(`--data inválido: ${o.data}`);
  if (!["memory", "weaviate"].includes(o.store)) throw new Error(`--store inválido: ${o.store}`);
  if (!["hash", "gemini"].includes(o.embed)) throw new Error(`--embed inválido: ${o.embed}`);
  return o;
}

export class MissingKeyError extends Error {}

export async function build(o: Options) {
  loadEnv();
  const cfg = config();
  const needKey = !o.offline || o.embed === "gemini";
  if (needKey && !cfg.geminiKey) throw new MissingKeyError("GEMINI_API_KEY ausente: crie agent/.env (veja agent/.env.example) ou use --offline");
  if (o.data === "postgres" && !cfg.databaseUrl) throw new Error("DATABASE_URL ausente para --data postgres (laboratório, nunca produção)");
  const data: DataProvider = o.data === "postgres" ? postgresProvider(cfg.databaseUrl) : demoProvider();
  const embeddings: Embeddings = o.embed === "gemini" ? await geminiEmbeddings(cfg.geminiKey) : new HashEmbeddings();
  const store: VectorStore = o.store === "weaviate" ? await weaviateStore() : new MemoryStore();
  const model: BaseChatModel = o.offline ? new ScriptedChatModel(offlineResponder) : await geminiChat(cfg.geminiKey, cfg.model);
  const modelName = o.offline ? "scripted-offline" : cfg.model;
  return { data, embeddings, store, model, modelName };
}
