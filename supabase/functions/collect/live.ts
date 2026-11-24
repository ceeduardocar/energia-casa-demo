// Coleta ao vivo da planta: potência (W) e total acumulado (kWh).
// ts = lastUpdateTime do logger arredondado a 5 min (não a hora da coleta).
import type { Db, Reading, Solarman } from "./types.ts";
import { bin5 } from "./time.ts";

export const DEVICE = "solar_plant";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** id da planta: o salvo em devices.external_id ou o único de station/list. */
export async function stationId(sm: Solarman, db: Db): Promise<string> {
  const saved = await db.getExternalId(DEVICE);
  if (saved) return saved;
  const list = await sm.stations();
  if (list.length !== 1) throw new Error(`esperava 1 planta, achei ${list.length}`);
  const id = String(list[0].id);
  await db.setExternalId(DEVICE, id);
  return id;
}

export async function collectLive(opts: { sm: Solarman; db: Db; maxPowerW: number }): Promise<{ written: number; notes: string[] }> {
  const { sm, db, maxPowerW } = opts;
  const rt = await sm.realTime(await stationId(sm, db));
  if (!isNum(rt.lastUpdateTime)) throw new Error("resposta sem lastUpdateTime");
  if (!isNum(rt.generationTotal)) throw new Error("resposta sem generationTotal");

  const ts = bin5(rt.lastUpdateTime);
  const notes: string[] = [];
  const rows: Reading[] = [{ device_id: DEVICE, metric: "energy_total_kwh", ts, value: rt.generationTotal }];

  const p = rt.generationPower;
  if (!isNum(p)) notes.push("resposta sem generationPower");
  else if (p < 0 || p > maxPowerW) notes.push(`potência fora da faixa: ${p} W`);
  else rows.push({ device_id: DEVICE, metric: "power_w", ts, value: p });

  const last = await db.lastReading(DEVICE, "energy_total_kwh");
  if (last && last.ts < ts && rt.generationTotal < last.value) {
    notes.push(`total diminuiu: ${last.value} -> ${rt.generationTotal}`);
  }

  return { written: await db.insertReadings(rows), notes };
}
