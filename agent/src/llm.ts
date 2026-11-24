// Modelo de chat: Gemini pelo LangChain.js. Temperatura 0 para respostas estáveis com números.
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export async function geminiChat(apiKey: string, model: string): Promise<BaseChatModel> {
  const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
  return new ChatGoogleGenerativeAI({ apiKey, model, temperature: 0, maxRetries: 2 });
}
