// Copia os registros do assistente para o Postgres do LABORATÓRIO (schema obs), para o painel do Grafana.
// Nunca aponte para o Supabase de produção: os registros têm as perguntas e as respostas.
import pg from "pg";
import type { Registro } from "./log.ts";

export const DDL = `
create schema if not exists obs;
create table if not exists obs.perguntas (
  id uuid primary key,
  inicio timestamptz not null,
  pergunta text not null,
  expert text not null,
  reserva boolean not null,
  ms_total integer not null,
  tokens_entrada integer not null,
  tokens_saida integer not null,
  chamadas_llm integer not null,
  ferramentas integer not null,
  ferramentas_erro integer not null,
  trechos integer not null,
  verificados integer not null,
  sem_fonte integer not null,
  erro text,
  registro jsonb not null
);
create index if not exists perguntas_inicio_idx on obs.perguntas (inicio);`;

export function toRow(r: Registro) {
  return [
    r.id, r.inicio, r.pergunta, r.rota.expert || "(nenhum)", r.rota.reserva, r.ms_total,
    r.tokens.entrada, r.tokens.saida, r.tokens.chamadas_llm,
    r.passos.length, r.passos.filter(p => !p.ok).length, r.recuperados.length,
    r.checagem.verificados, r.checagem.sem_fonte.length, r.erro ?? null, JSON.stringify(r),
  ];
}

export async function exportRecords(url: string, rows: Registro[]) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(DDL);
    for (const r of rows) {
      await client.query(
        `insert into obs.perguntas values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         on conflict (id) do nothing`, toRow(r));
    }
    const { rows: [c] } = await client.query("select count(*)::int as n from obs.perguntas");
    return c.n as number;
  } finally {
    await client.end();
  }
}
