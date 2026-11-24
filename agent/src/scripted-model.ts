// Modelo roteirizado: um BaseChatModel do LangChain.js que responde por uma função, sem rede.
// Usado nos testes e na avaliação offline (npm run eval:offline) para provar o encanamento inteiro:
// roteador com saída estruturada, chamadas de ferramenta, RAG, checagem de números e registro.
import { BaseChatModel, type BaseChatModelParams } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

export type Turn = { messages: BaseMessage[]; tools: string[] };
export type Responder = (turn: Turn) => AIMessage | Promise<AIMessage>;

export class ScriptedChatModel extends BaseChatModel {
  responder: Responder;
  boundTools: string[];
  calls: Turn[];
  constructor(responder: Responder, boundTools: string[] = [], calls: Turn[] = [], params: BaseChatModelParams = {}) {
    super(params);
    this.responder = responder;
    this.boundTools = boundTools;
    this.calls = calls;
  }
  _llmType() { return "scripted"; }
  override bindTools(tools: any[]): any {
    const names = tools.map(t => t?.name ?? t?.function?.name).filter(Boolean);
    return new ScriptedChatModel(this.responder, names, this.calls);
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const turn = { messages, tools: this.boundTools };
    this.calls.push(turn);
    const message = await this.responder(turn);
    const text = typeof message.content === "string" ? message.content : "";
    // A saída estruturada padrão do BaseChatModel só aceita AIMessageChunk.
    const chunk = new AIMessageChunk({ content: message.content, tool_calls: message.tool_calls, usage_metadata: message.usage_metadata });
    return { generations: [{ message: chunk, text }] };
  }
}

// Atalhos para montar respostas.
let seq = 0;
export const callTool = (name: string, args: Record<string, unknown> = {}) =>
  new AIMessage({ content: "", tool_calls: [{ name, args, id: `call_${++seq}`, type: "tool_call" }], usage_metadata: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } });
export const say = (content: string) =>
  new AIMessage({ content, usage_metadata: { input_tokens: 200, output_tokens: 50, total_tokens: 250 } });

// Último resultado de ferramenta (JSON) na conversa, ou null.
export function lastToolResult(messages: BaseMessage[], name?: string): any {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m: any = messages[i];
    if (m._getType?.() === "tool" || m.getType?.() === "tool") {
      if (name && m.name !== name) continue;
      try { return JSON.parse(String(m.content)); } catch { return m.content; }
    }
  }
  return null;
}
