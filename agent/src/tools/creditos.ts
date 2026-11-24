// creditos: meses das contas e saldo atual. O cálculo mês a mês é o mesmo do app (app/credits-months.js).
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { creditMonths, balanceChecks, MIN_BILLED_KWH } from "../../../app/credits-months.js";
import type { DataProvider } from "../data/provider.ts";
import { r2 } from "../format.ts";

export async function creditosResumo(data: DataProvider) {
  const [bills, atual] = await Promise.all([data.bills(), data.credits()]);
  const meses = creditMonths(bills);
  const conferencia = balanceChecks(meses);
  return {
    minimo_faturado_kwh: MIN_BILLED_KWH,
    regra: "o mínimo faturado não sai dos créditos; compensa-se só o consumo acima dele",
    meses: meses.map(m => ({
      mes: m.ref, consumido_kwh: r2(m.consumed), injetado_kwh: r2(m.injected), compensado_kwh: r2(m.compensated),
      credito_do_mes_usado_kwh: r2(m.own), credito_antigo_usado_kwh: r2(m.old), saldo_do_mes_kwh: r2(m.net),
      saldo_na_conta_kwh: r2(m.balance),
    })),
    conferencia_entre_meses: conferencia,
    agora: atual && {
      desde: atual.as_of, saldo_kwh: r2(atual.balance_kwh), importado_kwh: r2(atual.imported_kwh),
      exportado_kwh: r2(atual.exported_kwh), compensado_kwh: r2(atual.compensated_kwh),
      consumo_liquido_medio_kwh_dia: r2(atual.avg_net_drain_kwh_per_day),
      dias_restantes: atual.days_left == null ? null : Math.round(atual.days_left),
    },
    fonte: "bills + app/credits-months.js; v_credits",
  };
}

export const creditosTool = (data: DataProvider) => tool(
  async () => JSON.stringify(await creditosResumo(data)),
  {
    name: "creditos",
    description: "Créditos de energia: por conta (mês), consumido, injetado, compensado, crédito usado e saldo; conferência do saldo entre meses; saldo atual e quantos dias ele dura.",
    schema: z.object({}),
  },
);
