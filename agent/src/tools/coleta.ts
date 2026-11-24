// status_coleta: última rodada de cada fonte (v_collector_status) e um diagnóstico com as regras do coletor.
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { CollectorStatus, DataProvider } from "../data/provider.ts";

// A Solarman só é coletada das 06:30 às 18:55 (Brasília); o app tolera até 06:45. A Tuya roda 24 h.
// O cron roda a cada 5 min: até 12 min sem rodada nova ainda é "em dia".
export const ATRASO_MIN = 12;

const minutosDoDia = (iso: string) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  return +p.find(x => x.type === "hour")!.value * 60 + +p.find(x => x.type === "minute")!.value;
};

export function janelaSolarman(nowIso: string) {
  const m = minutosDoDia(nowIso);
  return m >= 6 * 60 + 45 && m <= 18 * 60 + 55;
}

export function diagnostico(s: CollectorStatus, nowIso: string) {
  if (!s.ok) return "falhando";
  if (s.age_minutes <= ATRASO_MIN) return "em dia";
  if (s.source === "solarman" && !janelaSolarman(nowIso)) return "pausa noturna";
  return "atrasada";
}

export async function statusColeta(data: DataProvider, nowIso = new Date().toISOString()) {
  const st = await data.collectorStatus();
  if (!st.length) return { fontes: [], aviso: "nenhuma rodada do coletor registrada", fonte: "v_collector_status" };
  return {
    agora: nowIso,
    fontes: st.map(s => ({ fonte_dados: s.source, ok: s.ok, ultima_rodada: s.started_at, idade_min: Math.round(s.age_minutes), diagnostico: diagnostico(s, nowIso) })),
    regras: `Solarman só de 06:30 às 18:55 (Brasília); Tuya 24 h; rodada a cada 5 min; acima de ${ATRASO_MIN} min sem rodada = atrasada`,
    fonte: "v_collector_status",
  };
}

export const coletaTool = (data: DataProvider, now: () => string = () => new Date().toISOString()) => tool(
  async () => JSON.stringify(await statusColeta(data, now())),
  {
    name: "status_coleta",
    description: "Estado da coleta de dados por fonte (solarman, tuya): última rodada, se deu certo, idade em minutos e diagnóstico (em dia, atrasada, falhando, pausa noturna).",
    schema: z.object({}),
  },
);
