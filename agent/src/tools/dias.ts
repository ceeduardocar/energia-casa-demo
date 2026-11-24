// resumo_dia e comparar_periodo: números de v_house_daily, sem cálculo pelo LLM.
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { addDays, dow } from "../../../app/util.js";
import type { DataProvider, DayRow } from "../data/provider.ts";
import { r2 } from "../format.ts";

const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Dia no formato AAAA-MM-DD (fuso de Brasília)");
const PARCELAS = ["ac", "bo", "outros"] as const;
const NOMES: Record<string, string> = { ac: "ar-condicionado", bo: "boiler", outros: "outros (casa sem ar e boiler)" };

export function resumoDoDia(row: DayRow) {
  return {
    dia: row.day, dia_semana: dow(row.day),
    geracao_kwh: r2(row.g), importado_kwh: r2(row.i), exportado_kwh: r2(row.e),
    consumo_kwh: r2(row.consumo), autoconsumo_kwh: r2(row.autoconsumo),
    autossuficiencia_pct: row.autossuficiencia == null ? null : Math.round(row.autossuficiencia * 100),
    ar_kwh: r2(row.ac), boiler_kwh: r2(row.bo), outros_kwh: r2(row.outros),
  };
}

export async function compararPeriodo(data: DataProvider, dia: string, diasAntes: number) {
  const rows = await data.days(addDays(dia, -diasAntes), dia);
  const alvo = rows.find(r => r.day === dia);
  if (!alvo) return { erro: `sem dados para ${dia}`, fonte: "v_house_daily" };
  const antes = rows.filter(r => r.day < dia && r.consumo != null);
  if (!antes.length) return { erro: `sem dias anteriores a ${dia} para comparar`, fonte: "v_house_daily" };
  const media = (k: keyof DayRow) => {
    const v = antes.map(r => r[k]).filter((x): x is number => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const mConsumo = media("consumo");
  const diferencas = PARCELAS.map(k => {
    const m = media(k), v = alvo[k] as number | null;
    return { parcela: NOMES[k], dia_kwh: r2(v), media_kwh: r2(m), diferenca_kwh: v == null || m == null ? null : r2(v - m) };
  });
  const principal = [...diferencas].filter(x => x.diferenca_kwh != null).sort((a, b) => Math.abs(b.diferenca_kwh!) - Math.abs(a.diferenca_kwh!))[0];
  return {
    dia, dias_comparados: antes.length, de: antes[0].day, ate: antes[antes.length - 1].day,
    consumo_dia_kwh: r2(alvo.consumo), consumo_medio_kwh: r2(mConsumo),
    diferenca_consumo_kwh: alvo.consumo == null || mConsumo == null ? null : r2(alvo.consumo - mConsumo),
    diferenca_consumo_pct: alvo.consumo == null || !mConsumo ? null : Math.round(((alvo.consumo - mConsumo) / mConsumo) * 100),
    geracao_dia_kwh: r2(alvo.g), geracao_media_kwh: r2(media("g")),
    importado_dia_kwh: r2(alvo.i), importado_medio_kwh: r2(media("i")),
    por_parcela: diferencas,
    maior_diferenca: principal?.parcela ?? null,
    fonte: "v_house_daily",
  };
}

export function diasTools(data: DataProvider) {
  const resumo = tool(
    async ({ dia }) => {
      const [row] = await data.days(dia, dia);
      if (!row) return JSON.stringify({ erro: `sem dados para ${dia}`, fonte: "v_house_daily" });
      return JSON.stringify({ ...resumoDoDia(row), fonte: "v_house_daily" });
    },
    {
      name: "resumo_dia",
      description: "Energia de um dia da casa em kWh: geração solar, importado e exportado da rede, consumo, autoconsumo, autossuficiência, ar-condicionado, boiler e outros.",
      schema: z.object({ dia: DIA }),
    },
  );
  const comparar = tool(
    async ({ dia, dias_antes }) => JSON.stringify(await compararPeriodo(data, dia, dias_antes ?? 7)),
    {
      name: "comparar_periodo",
      description: "Compara o consumo de um dia com a média dos N dias anteriores e diz qual parcela (ar, boiler, outros) mais explica a diferença.",
      schema: z.object({ dia: DIA, dias_antes: z.number().int().min(2).max(30).optional().describe("Quantos dias anteriores entram na média (padrão 7)") }),
    },
  );
  return [resumo, comparar];
}
