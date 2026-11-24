// Leitura de dados do assistente. Duas implementações: demo (sem banco) e postgres (laboratório).
// Os nomes dos campos são os das views do banco, para o mesmo código servir às duas.

export type DayRow = {
  day: string;
  g: number | null;          // geração solar (kWh)
  i: number | null;          // importado da rede (kWh)
  e: number | null;          // exportado para a rede (kWh)
  ac: number | null;         // ar-condicionado (kWh)
  bo: number | null;         // boiler (kWh)
  consumo: number | null;    // g + i − e
  autoconsumo: number | null;
  autossuficiencia: number | null; // 0..1
  outros: number | null;     // consumo − ar − boiler
};

export type Bill = Record<string, unknown> & { ref_month?: string };

export type CreditsNow = {
  as_of: string | null;
  balance_kwh: number | null;
  days_left: number | null;
  avg_net_drain_kwh_per_day: number | null;
  imported_kwh: number | null;
  exported_kwh: number | null;
  compensated_kwh: number | null;
  min_billed_kwh: number | null;
};

export type CollectorStatus = { source: string; ok: boolean; started_at: string; age_minutes: number };

export interface DataProvider {
  readonly name: string;
  days(from: string, to: string): Promise<DayRow[]>;
  bills(): Promise<Bill[]>;
  credits(): Promise<CreditsNow | null>;
  collectorStatus(): Promise<CollectorStatus[]>;
  close?(): Promise<void>;
}
