// Horários do coletor. Banco em UTC; dias no fuso America/Sao_Paulo.

export const TZ = "America/Sao_Paulo";
const STEP = 300; // 5 min, em segundos

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const offFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" });
const hmFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Janela da Solarman: 06:30 a 18:55 de Brasília (inclusive). Fora dela o logger quase não gera. */
export function inSolarWindow(epochMs: number): boolean {
  const [h, m] = hmFmt.format(new Date(epochMs)).split(":").map(Number);
  const min = h * 60 + m;
  return min >= 6 * 60 + 30 && min <= 18 * 60 + 55;
}

/** Epoch (s) arredondado para baixo ao passo de 5 min, em ISO UTC. */
export function bin5(epochSec: number): string {
  return new Date(Math.floor(epochSec / STEP) * STEP * 1000).toISOString();
}

/** Dia local (YYYY-MM-DD) de um epoch em segundos. */
export function localDay(epochSec: number): string {
  return dayFmt.format(new Date(epochSec * 1000));
}

/** Soma dias a uma data YYYY-MM-DD. */
export function addDays(day: string, n: number): string {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Deslocamento do fuso (minutos, ex.: -180) num instante. */
function offsetMinutes(epochMs: number): number {
  const name = offFmt.formatToParts(new Date(epochMs)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

/** Instante UTC (ISO) de um horário local "HH:MM" num dia local. */
export function localTime(day: string, hhmm: string): string {
  const guess = Date.parse(`${day}T${hhmm}:00Z`);
  return new Date(guess - offsetMinutes(guess) * 60000).toISOString();
}

/** Último passo de 5 min do dia local (23:55). */
export function localEndSlot(day: string): string {
  return localTime(day, "23:55");
}
