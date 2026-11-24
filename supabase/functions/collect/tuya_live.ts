// Coleta Tuya ao vivo: um shadow por medidor, convertido pelo device_metric_map.
// ts = horário do código (time, em ms) arredondado a 5 min. Código que não mudou
// não cria linha nova, e a escrita idempotente cuida das repetidas.
// Falha de rede ou de token não é anotada aqui: sobe para o runAll.
import type { Db, MapRow, Reading } from "./types.ts";
import type { Tuya } from "./tuya.ts";
import { bin5 } from "./time.ts";

const GRID = "grid_meter";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Arredonda a 6 casas: 18 × 0,1 deve dar 1,8, não 1,8000000000000003. */
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * O Breaker sempre publica power_total positivo. O sentido instantaneo vem do
 * contador atualizado por ultimo: forward = importando, reverse = exportando.
 * Se os dois contadores tem o mesmo horario, o sentido ainda e desconhecido.
 */
export function gridPowerDirection(mapped: MapRow[], byCode: Map<string, { time: number }>): 1 | -1 | null {
  const codeFor = (metric: string) => mapped.find((m) => m.device_id === GRID && m.metric === metric)?.source_code;
  const importCode = codeFor("energy_import_total_kwh");
  const exportCode = codeFor("energy_export_total_kwh");
  const importedAt = importCode ? byCode.get(importCode)?.time : undefined;
  const exportedAt = exportCode ? byCode.get(exportCode)?.time : undefined;
  if (!isNum(importedAt) || !isNum(exportedAt) || importedAt === exportedAt) return null;
  return importedAt > exportedAt ? 1 : -1;
}

/** applianceMinW: abaixo disso a potência de um aparelho (não o medidor geral) é tratada como desligado (0 W). */
export async function collectTuya(opts: { tuya: Tuya; db: Db; maxPowerW: number; applianceMinW?: number }): Promise<{ written: number; notes: string[] }> {
  const { tuya, db, maxPowerW } = opts;
  const minW = opts.applianceMinW ?? 0;
  const notes: string[] = [];
  const rows: Reading[] = [];

  const byDevice = new Map<string, MapRow[]>();
  for (const m of await db.metricMap("tuya")) byDevice.set(m.external_id, [...(byDevice.get(m.external_id) ?? []), m]);

  for (const [externalId, mapped] of byDevice) {
    const props = await tuya.shadow(externalId);
    const byCode = new Map(props.map((p) => [p.code, p]));
    const gridDirection = gridPowerDirection(mapped, byCode);

    for (const m of mapped) {
      const p = byCode.get(m.source_code);
      if (!p) { notes.push(`código ausente: ${m.source_code}`); continue; }
      if (!isNum(p.value)) { notes.push(`valor inválido: ${m.source_code}`); continue; }

      let value = round6(p.value * m.scale);
      if (m.metric === "power_w") {
        const magnitude = Math.abs(value);
        // Aparelho desligado: o medidor mostra negativo ou ruído de outros aparelhos. Abaixo do mínimo vale 0 W;
        // descartar congelava a última leitura ligada.
        if (m.device_id !== GRID && value < Math.max(minW, 0)) value = 0;
        if (magnitude > maxPowerW) { notes.push(`potência fora da faixa: ${m.source_code} ${round6(p.value * m.scale)} W`); continue; }
        if (m.device_id === GRID) {
          if (gridDirection === null) notes.push("sentido instantaneo da rede indisponivel");
          else rows.push({ device_id: m.device_id, metric: "power_signed_w", ts: bin5(p.time / 1000), value: magnitude * gridDirection });
          value = magnitude;
        }
      } else if (value < 0) {
        notes.push(`acumulado negativo descartado: ${m.source_code}`);
        continue;
      }

      const ts = bin5(p.time / 1000);
      if (m.metric !== "power_w") {
        const last = await db.lastReading(m.device_id, m.metric);
        if (last && last.ts < ts && value < last.value) notes.push(`total diminuiu: ${m.source_code} ${last.value} -> ${value}`);
      }
      rows.push({ device_id: m.device_id, metric: m.metric, ts, value });
    }
  }

  return { written: await db.insertReadings(rows), notes };
}
