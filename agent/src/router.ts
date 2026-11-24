// Roteador: escolhe o expert pela pergunta. LLM com saída estruturada; se falhar, palavras-chave.
import { z } from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { normalize } from "./rag/text.ts";

export const EXPERTS = ["consumo", "creditos", "operacao"] as const;
export type ExpertName = (typeof EXPERTS)[number];

export const RotaSchema = z.object({
  expert: z.enum(EXPERTS).describe("consumo: gasto, geração e aparelhos por dia; creditos: créditos, saldo, conta de luz e fatura; operacao: coleta, medidores, atraso ou falha dos dados"),
  motivo: z.string().describe("Uma frase curta com o motivo da escolha"),
});
export type Rota = z.infer<typeof RotaSchema> & { reserva: boolean };

const PROMPT = `Você distribui perguntas sobre a energia de uma casa com painéis solares para um de três especialistas.
- consumo: quanto a casa consumiu ou gerou, comparação entre dias, ar-condicionado, boiler, autossuficiência.
- creditos: créditos de energia, saldo, quanto dura, conta de luz, fatura, mínimo faturado, compensação.
- operacao: se a coleta dos dados está funcionando, atraso, falha, Solarman, Tuya, medidores.
Responda só com o especialista e o motivo.`;

const REGRAS: [ExpertName, RegExp][] = [
  ["operacao", /\b(colet|coletor|tuya|solarman|funcionand|atualiz|atras|falh|offline|medidor|leitura)/],
  ["creditos", /\b(credit|saldo|conta|fatura|injet|compens|minimo|neoenergia|bandeira|cobr)/],
];

export function rotaPorPalavras(pergunta: string): Rota {
  const q = normalize(pergunta);
  for (const [expert, re] of REGRAS) if (re.test(q)) return { expert, motivo: "palavras-chave", reserva: true };
  return { expert: "consumo", motivo: "padrão", reserva: true };
}

export async function rotear(model: BaseChatModel, pergunta: string): Promise<Rota> {
  try {
    const r = await model.withStructuredOutput(RotaSchema, { name: "rotear" }).invoke([
      { role: "system", content: PROMPT },
      { role: "user", content: pergunta },
    ]);
    const ok = RotaSchema.safeParse(r);
    if (ok.success) return { ...ok.data, reserva: false };
  } catch {
    // cai na reserva abaixo
  }
  return rotaPorPalavras(pergunta);
}
