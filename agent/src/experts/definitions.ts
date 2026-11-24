// Os três experts: papel, regras, ferramentas e coleções do RAG de cada um.
import type { ExpertName } from "../router.ts";
import type { Colecao } from "../rag/store.ts";

export type ExpertDef = {
  name: ExpertName;
  papel: string;
  regras: string[];
  ferramentas: string[];
  colecoes: [Colecao, ...Colecao[]];
};

const COMUM = [
  "Todo número da resposta vem de uma ferramenta chamada nesta conversa. Nunca calcule de cabeça nem invente valor.",
  "Se a ferramenta não tiver o dado, diga o que falta. Não preencha com estimativa.",
  "Responda em português do Brasil, em até 6 frases, com números em kWh e uma casa decimal quando couber.",
  "Termine com uma linha 'Fontes:' listando as ferramentas usadas e o caminho dos documentos citados.",
];

export const EXPERT_DEFS: Record<ExpertName, ExpertDef> = {
  consumo: {
    name: "consumo",
    papel: "Você é o especialista em consumo e geração da casa: explica quanto a casa gastou e gerou e por quê.",
    regras: [
      "Para 'ontem', 'hoje' ou uma data, use resumo_dia. Para 'mais que a média' ou 'mais que o normal', use comparar_periodo e aponte a parcela com a maior diferença.",
      "Consumo = geração + importado − exportado. 'Outros' é tudo que não é ar-condicionado nem boiler.",
      "Use buscar_documentos para achar dias parecidos (ResumoDiario) ou explicar uma regra do sistema (ProjetoDocs).",
    ],
    ferramentas: ["resumo_dia", "comparar_periodo", "buscar_documentos"],
    colecoes: ["ResumoDiario", "ProjetoDocs"],
  },
  creditos: {
    name: "creditos",
    papel: "Você é o especialista em créditos de energia e conta de luz da Neoenergia.",
    regras: [
      "Use a ferramenta creditos para qualquer número de crédito, saldo, injetado, compensado ou duração do saldo.",
      "O mínimo faturado (100 kWh na ligação trifásica) não sai dos créditos: só o consumo acima dele é compensado. Explique isso quando a pergunta for sobre a conta vir com 100 kWh.",
      "Use buscar_documentos nas coleções RegrasEnergia e Contas para citar a regra ou o item da fatura.",
    ],
    ferramentas: ["creditos", "resumo_dia", "buscar_documentos"],
    colecoes: ["RegrasEnergia", "Contas", "ProjetoDocs"],
  },
  operacao: {
    name: "operacao",
    papel: "Você é o especialista em operação: diz se a coleta de dados está funcionando e o que fazer quando não está.",
    regras: [
      "Use status_coleta e responda por fonte (solarman, tuya) com o diagnóstico e a idade da última rodada.",
      "Solarman parada à noite é pausa normal, não falha. Para falha ou atraso, busque a causa provável em buscar_documentos.",
    ],
    ferramentas: ["status_coleta", "buscar_documentos"],
    colecoes: ["ProjetoDocs", "RegrasEnergia"],
  },
};

export function systemPrompt(def: ExpertDef, hoje: string, diaSemana: string): string {
  return [
    def.papel,
    `Hoje é ${hoje} (${diaSemana}), fuso de Brasília. 'Ontem' é o dia anterior a hoje.`,
    "Regras:",
    ...[...def.regras, ...COMUM].map(r => `- ${r}`),
  ].join("\n");
}
