// Política roteirizada para o ScriptedChatModel: faz o papel do LLM sem rede, com regras fixas.
// Serve para a avaliação offline e os testes de ponta a ponta. NÃO é o assistente de verdade: prova que roteador,
// ferramentas, RAG, checagem de números e registro funcionam juntos; a qualidade da redação se mede com o Gemini.
import type { BaseMessage } from "@langchain/core/messages";
import { addDays } from "../../app/util.js";
import { callTool, lastToolResult, say, type Turn } from "./scripted-model.ts";
import { rotaPorPalavras } from "./router.ts";
import { normalize } from "./rag/text.ts";
import { f1, f2 } from "./format.ts";

const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const content = (m: BaseMessage) => (typeof m.content === "string" ? m.content : "");
const typeOf = (m: any) => m.getType?.() ?? m._getType?.();

function contexto(messages: BaseMessage[]) {
  const sys = content(messages.find(m => typeOf(m) === "system")!);
  const pergunta = content(messages.find(m => typeOf(m) === "human")!);
  const hoje = /Hoje é (\d{4}-\d{2}-\d{2})/.exec(sys)?.[1] ?? "";
  const data = /\b(\d{4}-\d{2}-\d{2})\b/.exec(pergunta)?.[1];
  const q = normalize(pergunta);
  const dia = data ?? (/\bhoje\b/.test(q) ? hoje : addDays(hoje, -1));
  return { pergunta, q, hoje, dia };
}

const fontesDocs = (r: any): string[] => [...new Set<string>((r?.trechos ?? []).slice(0, 2).map((t: any) => t.caminho))];

export function offlineResponder({ messages, tools }: Turn) {
  if (tools.includes("rotear")) {
    const pergunta = content(messages.find(m => typeOf(m) === "human")!);
    const { expert } = rotaPorPalavras(pergunta);
    return callTool("rotear", { expert, motivo: "política offline por palavras-chave" });
  }
  const { q, dia } = contexto(messages);
  const docs = lastToolResult(messages, "buscar_documentos");

  if (tools.includes("status_coleta")) {
    const st = lastToolResult(messages, "status_coleta");
    if (!st) return callTool("status_coleta");
    const problema = (st.fontes ?? []).some((f: any) => f.diagnostico === "falhando" || f.diagnostico === "atrasada");
    if (problema && !docs) return callTool("buscar_documentos", { consulta: "coleta falhando atrasada causa provável token teste Tuya IoT Core" });
    if (!st.fontes?.length) return say(`Não há rodadas do coletor registradas.\nFontes: status_coleta`);
    const linhas = st.fontes.map((f: any) => `${f.fonte_dados}: ${f.diagnostico}, última rodada há ${f.idade_min} min.`);
    return say([...linhas, `Fontes: status_coleta${docs ? ", " + fontesDocs(docs).join(", ") : ""}`].join("\n"));
  }

  if (tools.includes("creditos")) {
    const c = lastToolResult(messages, "creditos");
    if (!c) return callTool("creditos");
    const sobreConta = /\b(conta|fatura|100|minimo|cobr)/.test(q);
    if (sobreConta && !docs) return callTool("buscar_documentos", { consulta: "mínimo faturado 100 kWh trifásica conta compensação", colecao: "RegrasEnergia" });
    const ultimo = c.meses.at(-1);
    // O primeiro mês citado na pergunta (por posição no texto) é o mês da conta.
    const pos = MESES.map(nome => q.indexOf(nome)), first = Math.min(...pos.filter(x => x >= 0));
    const n = pos.indexOf(first);
    const m = (n >= 0 && c.meses.find((x: any) => +x.mes.slice(5, 7) === n + 1)) || ultimo;
    if (/\b(bate|confere|conferencia)/.test(q) && m) {
      const cf = c.conferencia_entre_meses.find((x: any) => x.ref === m.mes);
      return say([
        `Saldo na conta de ${m.mes}: ${f2(m.saldo_na_conta_kwh)} kWh; saldo do mês (injetado − compensado): ${f2(m.saldo_do_mes_kwh)} kWh.`,
        cf?.status === "ok" ? "A conferência com o mês anterior fecha (diferença 0)." : `A conferência com o mês anterior deu: ${cf?.status ?? "sem dados"}.`,
        "Fontes: creditos",
      ].join("\n"));
    }
    const partes = sobreConta && m
      ? [`Na conta de ${m.mes} a casa consumiu ${f2(m.consumido_kwh)} kWh e injetou ${f2(m.injetado_kwh)} kWh.`,
         `O mínimo faturado de ${c.minimo_faturado_kwh} kWh não sai dos créditos: foram compensados ${f2(m.compensado_kwh)} kWh, ` +
           (m.saldo_do_mes_kwh >= 0 ? `e sobraram ${f2(m.saldo_do_mes_kwh)} kWh para o saldo.` : `dos quais ${f2(m.credito_antigo_usado_kwh)} kWh vieram de créditos de meses anteriores.`)]
      : [`Saldo atual de ${f2(c.agora?.saldo_kwh)} kWh desde ${c.agora?.desde}.`,
         c.agora?.dias_restantes == null ? "O saldo não está diminuindo, então não há data para acabar." : `No ritmo atual dura cerca de ${c.agora.dias_restantes} dias.`];
    return say([...partes, `Fontes: creditos${docs ? ", " + fontesDocs(docs).join(", ") : ""}`].join("\n"));
  }

  const media = /\b(media|normal|mais que|menos que|comparad)/.test(q);
  if (media) {
    const r = lastToolResult(messages, "comparar_periodo");
    if (!r) return callTool("comparar_periodo", { dia, dias_antes: 7 });
    if (r.erro) return say(`Não há dados para comparar: ${r.erro}.\nFontes: comparar_periodo`);
    const p = r.por_parcela.find((x: any) => x.parcela === r.maior_diferenca);
    return say([
      `Em ${r.dia} a casa consumiu ${f1(r.consumo_dia_kwh)} kWh, contra a média de ${f1(r.consumo_medio_kwh)} kWh dos ${r.dias_comparados} dias anteriores (${f1(r.diferenca_consumo_kwh)} kWh).`,
      p ? `A maior diferença foi no ${p.parcela}: ${f1(p.dia_kwh)} kWh contra ${f1(p.media_kwh)} kWh na média.` : "",
      "Fontes: comparar_periodo",
    ].filter(Boolean).join("\n"));
  }
  const r = lastToolResult(messages, "resumo_dia");
  if (!r) return callTool("resumo_dia", { dia });
  if (r.erro) return say(`Não há dados de ${dia}.\nFontes: resumo_dia`);
  return say([
    `Em ${r.dia} a casa consumiu ${f1(r.consumo_kwh)} kWh e gerou ${f1(r.geracao_kwh)} kWh, com ${r.autossuficiencia_pct}% de autossuficiência.`,
    `Ar-condicionado ${f1(r.ar_kwh)} kWh, boiler ${f1(r.boiler_kwh)} kWh, outros ${f1(r.outros_kwh)} kWh.`,
    "Fontes: resumo_dia",
  ].join("\n"));
}
