// Backfill do histórico da planta, um pedaço por rodada, do dia da primeira leitura
// ao vivo (S) para trás até o início da operação. Ver plano 2, decisão 7.
//   B(D) = hodômetro no início do dia D;  B(D) = B(D+1) − diário(D)
//   âncora: B(S) = L0 − c_S(t0), e no dia S só entram leituras com ts < t0.
import type { Db, Frame, Reading, Solarman } from "./types.ts";
import { DEVICE, stationId } from "./live.ts";
import { addDays, bin5, localDay, localEndSlot } from "./time.ts";

const K = {
  enabled: "solarman_backfill_enabled",
  anchor: "solarman_backfill_anchor", // "ts|valor" da primeira leitura ao vivo
  cursor: "solarman_backfill_cursor", // próximo dia a processar
  base: "solarman_backfill_base", //     B(cursor + 1)
  start: "solarman_backfill_start", //   dia de início da operação
  done: "solarman_backfill_done",
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Leituras de um dia a partir dos quadros de 5 min e do kWh diário. */
export function buildDay(o: { day: string; frames: Frame[]; dailyKwh: number; base: number; before?: string }): { rows: Reading[]; end: number } {
  const byBin = new Map<string, number>();
  for (const f of [...o.frames].sort((a, b) => a.dateTime - b.dateTime)) {
    if (localDay(f.dateTime) !== o.day) continue;
    const p = typeof f.generationPower === "number" && f.generationPower > 0 ? f.generationPower : 0;
    byBin.set(bin5(f.dateTime), p); // mesmo bin: fica o último
  }
  const pts = [...byBin.entries()].map(([ts, w]) => ({ ts, t: Date.parse(ts) / 1000, w }));

  // integral por trapézios (W·s)
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + ((pts[i - 1].w + pts[i].w) / 2) * (pts[i].t - pts[i - 1].t));
  const total = cum.at(-1) ?? 0;

  const end = r3(o.base + o.dailyKwh);
  const rows: Reading[] = pts.map((p) => ({ device_id: DEVICE, metric: "power_w", ts: p.ts, value: p.w }));
  if (pts.length && (total > 0 || o.dailyKwh === 0)) {
    const k = total > 0 ? o.dailyKwh / total : 0;
    pts.forEach((p, i) => rows.push({
      device_id: DEVICE, metric: "energy_total_kwh", ts: p.ts,
      value: i === pts.length - 1 ? end : r3(o.base + cum[i] * k),
    }));
  } else {
    rows.push({ device_id: DEVICE, metric: "energy_total_kwh", ts: localEndSlot(o.day), value: end });
  }
  return { rows: o.before ? rows.filter((r) => r.ts < o.before!) : rows, end };
}

export async function backfillStep(o: { sm: Solarman; db: Db; clock: () => number; daysPerRun: number }): Promise<{ written: number; done: boolean; notes: string[] }> {
  const { sm, db } = o;
  const idle = (done = false) => ({ written: 0, done, notes: [] as string[] });
  if ((await db.getSetting(K.enabled)) !== "true") return idle();
  if ((await db.getSetting(K.done)) === "true") return idle(true);

  // âncora: fixada antes de gravar qualquer coisa (depois, firstReading já seria do histórico)
  let anchor = await db.getSetting(K.anchor);
  if (!anchor) {
    const first = await db.firstReading(DEVICE, "energy_total_kwh");
    if (!first) return idle();
    anchor = `${first.ts}|${first.value}`;
    await db.setSetting(K.anchor, anchor);
  }
  const [t0, l0s] = anchor.split("|");
  const L0 = Number(l0s);
  const S = localDay(Date.parse(t0) / 1000);
  if (localDay(o.clock() / 1000) <= S) return idle(); // o diário de S ainda não fechou

  const id = await stationId(sm, db);
  let start = await db.getSetting(K.start);
  if (!start) {
    const st = (await sm.stations()).find((s) => String(s.id) === id);
    if (!st?.startOperatingTime) throw new Error("planta sem startOperatingTime");
    start = localDay(st.startOperatingTime);
    await db.setSetting(K.start, start);
  }

  let cursor = (await db.getSetting(K.cursor)) ?? S;
  const baseS = await db.getSetting(K.base);
  let base = baseS === null ? null : Number(baseS);
  let last = addDays(cursor, -(o.daysPerRun - 1));
  if (last < start) last = start;

  const daily = new Map<string, number>();
  for (const d of await sm.daily(id, last, cursor)) {
    const key = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
    daily.set(key, typeof d.generationValue === "number" ? d.generationValue : 0);
  }

  let written = 0;
  while (cursor >= last) {
    const day = cursor;
    const frames = await sm.frames(id, day);
    const kwh = daily.get(day) ?? 0;
    let b: number;
    let rows: Reading[];
    if (day === S) {
      const probe = buildDay({ day, frames, dailyKwh: kwh, base: 0 }).rows
        .filter((r) => r.metric === "energy_total_kwh" && r.ts <= t0).at(-1);
      b = r3(L0 - (probe?.value ?? 0));
      rows = buildDay({ day, frames, dailyKwh: kwh, base: b, before: t0 }).rows;
    } else {
      if (base === null) throw new Error("backfill sem base para " + day);
      b = r3(base - kwh);
      rows = buildDay({ day, frames, dailyKwh: kwh, base: b }).rows;
    }
    for (let i = 0; i < rows.length; i += 1000) written += await db.insertReadings(rows.slice(i, i + 1000));
    base = b;
    cursor = addDays(day, -1);
    await db.setSetting(K.base, String(base));
    await db.setSetting(K.cursor, cursor);
  }

  const done = cursor < start;
  if (done) {
    // hodômetro na véspera do início: sem ele o 1º dia teria delta 0 nas views
    if (base !== null) written += await db.insertReadings([{ device_id: DEVICE, metric: "energy_total_kwh", ts: localEndSlot(cursor), value: base }]);
    await db.setSetting(K.done, "true");
  }
  return { written, done, notes: [] };
}
