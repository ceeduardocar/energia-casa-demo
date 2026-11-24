// Tipos compartilhados do coletor. Só sintaxe TypeScript apagável (roda no Deno e no Node 24).

export type Reading = { device_id: string; metric: string; ts: string; value: number };

export type Run = { source: string; ok: boolean; readings_written: number; error_message: string | null };

/** Linha de device_metric_map: código da fonte → métrica interna. scale = fator bruto → unidade interna. */
export type MapRow = { external_id: string; source_code: string; device_id: string; metric: string; scale: number };

export interface Db {
  getToken(source: string): Promise<{ token: string; expires_at: string } | null>;
  saveToken(source: string, token: string, expiresAt: string): Promise<void>;
  metricMap(source: string): Promise<MapRow[]>;
  getExternalId(deviceId: string): Promise<string | null>;
  setExternalId(deviceId: string, externalId: string): Promise<void>;
  /** ON CONFLICT DO NOTHING; devolve quantas linhas entraram. */
  insertReadings(rows: Reading[]): Promise<number>;
  lastReading(deviceId: string, metric: string): Promise<{ ts: string; value: number } | null>;
  firstReading(deviceId: string, metric: string): Promise<{ ts: string; value: number } | null>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  logRun(run: Run): Promise<void>;
}

/** Relógio injetável: devolve epoch em milissegundos. */
export type Clock = () => number;

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type SolarmanEnv = { appId: string; appSecret: string; email: string; passwordSha256: string };

export type Station = { id: number; name: string; startOperatingTime?: number };
export type RealTime = { generationPower?: number | null; generationTotal?: number | null; lastUpdateTime?: number | null };
export type Frame = { dateTime: number; generationPower: number | null };
export type DailyItem = { year: number; month: number; day: number; generationValue: number | null };

export interface Solarman {
  stations(): Promise<Station[]>;
  realTime(stationId: string): Promise<RealTime>;
  frames(stationId: string, day: string): Promise<Frame[]>;
  daily(stationId: string, from: string, to: string): Promise<DailyItem[]>;
}
