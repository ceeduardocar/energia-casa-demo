// Roda as fontes em sequência, cada uma com tempo limite próprio, e registra
// uma linha em collector_runs por fonte. Falha numa fonte não impede as outras;
// falha no backfill não marca a coleta ao vivo como falha.
// Modo "backfill" (agendamento noturno): pula o ao vivo e só registra a rodada se
// o backfill gravou algo ou falhou, para não poluir collector_runs nem o selo do app.
import type { Db } from "./types.ts";

/** null = não devido nesta rodada (ex.: Solarman fora da janela diurna): sem registro em collector_runs. */
export type Step = () => Promise<{ written: number; notes: string[] } | null>;
export type Source = { name: string; live: Step; backfill?: Step };

const MAX_MSG = 500;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`tempo esgotado (${ms / 1000} s)`)), ms); });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

export async function runAll(o: { sources: Source[]; db: Db; liveTimeoutMs: number; backfillTimeoutMs: number; mode?: "all" | "backfill" }) {
  const results: { source: string; ok: boolean; written: number }[] = [];
  const onlyBackfill = o.mode === "backfill";
  for (const s of o.sources) {
    if (onlyBackfill && !s.backfill) continue;
    let ok = true, written = 0, skipped = false;
    const notes: string[] = [];
    if (!onlyBackfill) try {
      const r = await withTimeout(s.live(), o.liveTimeoutMs);
      if (r === null) skipped = true;
      else {
        written += r.written;
        notes.push(...r.notes);
      }
    } catch (e) {
      ok = false;
      notes.push((e as Error).message);
    }
    // Fora da janela (skipped) a fonte inteira fica quieta, inclusive o backfill: o backfill noturno tem o próprio agendamento.
    if (ok && s.backfill && !skipped) {
      try {
        const r = await withTimeout(s.backfill(), o.backfillTimeoutMs);
        written += r.written;
        notes.push(...r.notes.map((n) => "backfill: " + n));
      } catch (e) {
        notes.push("backfill: " + (e as Error).message);
        if (onlyBackfill) ok = false;
      }
    }
    if ((onlyBackfill || skipped) && ok && written === 0 && !notes.length) continue;
    const msg = notes.length ? notes.join("; ").slice(0, MAX_MSG) : null;
    try {
      await o.db.logRun({ source: s.name, ok, readings_written: written, error_message: msg });
    } catch {
      // sem registro da rodada; segue para a próxima fonte
    }
    results.push({ source: s.name, ok, written });
  }
  return results;
}
