// Fonte "demo": as mesmas curvas e contas de exemplo do modo demonstração do app (app/demo.js).
// Sem banco e sem rede; os dias passados são determinísticos (a curva depende só da data).
import { demo } from "../../../app/demo.js";
import type { CollectorStatus, DataProvider, DayRow } from "./provider.ts";

export type DemoOptions = { status?: CollectorStatus[] };

export function demoProvider(opts: DemoOptions = {}): DataProvider {
  return {
    name: "demo",
    async days(from, to) {
      return (await demo.fetchDaily(from, to)) as DayRow[];
    },
    async bills() {
      return (await demo.fetchBills()).map((b: Record<string, unknown>) => ({ ...b }));
    },
    async credits() {
      const c = await demo.fetchCredits();
      return {
        as_of: c.as_of, balance_kwh: c.balance_kwh, days_left: c.days_left,
        avg_net_drain_kwh_per_day: c.avg_net_drain_kwh_per_day, imported_kwh: c.imported_kwh,
        exported_kwh: c.exported_kwh, compensated_kwh: c.compensated_kwh, min_billed_kwh: c.min_billed_kwh,
      };
    },
    async collectorStatus() {
      return opts.status ?? (await demo.fetchNow()).status;
    },
  };
}
