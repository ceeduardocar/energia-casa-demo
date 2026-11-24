import type { CollectorStatus, DataProvider, DayRow } from "../src/data/provider.ts";

export const row = (day: string, p: Partial<DayRow> = {}): DayRow => {
  const g = p.g ?? 10, i = p.i ?? 8, e = p.e ?? 4, ac = p.ac ?? 3, bo = p.bo ?? 2;
  const consumo = p.consumo ?? g + i - e;
  return { day, g, i, e, ac, bo, consumo, autoconsumo: g - e, autossuficiencia: (g - e) / consumo, outros: Math.max(consumo - ac - bo, 0), ...p };
};

export function fixedProvider(rows: DayRow[], extra: Partial<DataProvider> & { status?: CollectorStatus[] } = {}): DataProvider {
  return {
    name: "fixo",
    async days(from, to) { return rows.filter(r => r.day >= from && r.day <= to); },
    async bills() { return []; },
    async credits() { return null; },
    async collectorStatus() { return extra.status ?? []; },
    ...extra,
  };
}
