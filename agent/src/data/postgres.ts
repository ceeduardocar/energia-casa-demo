// Fonte "postgres": o banco do laboratório (migrations do repo + supabase/seed_demo.sql).
// Só select. Nunca aponte DATABASE_URL para o Supabase de produção (ver docs/superpowers/specs/2026-11-23-assistente-design.md, seção 5).
import pg from "pg";
import type { DataProvider, DayRow } from "./provider.ts";

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const d = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v).slice(0, 10));

export function postgresProvider(url: string): DataProvider {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  // As datas de "day" e "ref_month" voltam como texto, sem conversão de fuso pelo driver.
  pg.types.setTypeParser(1082, (s: string) => s);
  return {
    name: "postgres",
    async days(from, to) {
      const { rows } = await pool.query(
        `select day::text, g, i, e, ac, bo, consumo, autoconsumo, autossuficiencia, outros
           from public.v_house_daily where day between $1 and $2 order by day`, [from, to]);
      return rows.map((r): DayRow => ({
        day: r.day, g: n(r.g), i: n(r.i), e: n(r.e), ac: n(r.ac), bo: n(r.bo), consumo: n(r.consumo),
        autoconsumo: n(r.autoconsumo), autossuficiencia: n(r.autossuficiencia), outros: n(r.outros),
      }));
    },
    async bills() {
      const { rows } = await pool.query(`select * from public.bills order by ref_month`);
      return rows.map(r => ({ ...r, ref_month: d(r.ref_month) ?? undefined }));
    },
    async credits() {
      const { rows } = await pool.query(`select * from public.v_credits limit 1`);
      const r = rows[0];
      if (!r) return null;
      return {
        as_of: d(r.as_of), balance_kwh: n(r.balance_kwh), days_left: n(r.days_left),
        avg_net_drain_kwh_per_day: n(r.avg_net_drain_kwh_per_day), imported_kwh: n(r.imported_kwh),
        exported_kwh: n(r.exported_kwh), compensated_kwh: n(r.compensated_kwh), min_billed_kwh: n(r.min_billed_kwh),
      };
    },
    async collectorStatus() {
      const { rows } = await pool.query(
        `select source, ok, started_at, age_minutes from public.v_collector_status order by source`);
      return rows.map(r => ({ source: r.source, ok: r.ok, started_at: new Date(r.started_at).toISOString(), age_minutes: Number(r.age_minutes) }));
    },
    async close() { await pool.end(); },
  };
}
