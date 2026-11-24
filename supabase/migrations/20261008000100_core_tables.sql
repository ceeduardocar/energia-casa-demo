-- Tabelas base do Energia Casa (spec, seção 5).
-- Horários em timestamptz (UTC); dias calculados nas views em America/Sao_Paulo.

create table public.devices (
  id          text primary key,
  source      text not null check (source in ('solarman', 'tuya')),
  kind        text not null check (kind in ('solar_plant', 'grid_meter', 'appliance_meter')),
  name        text not null,
  external_id text
);

insert into public.devices (id, source, kind, name) values
  ('solar_plant',      'solarman', 'solar_plant',     'Geração solar'),
  ('grid_meter',       'tuya',     'grid_meter',      'Rede'),
  ('appliance_ac',     'tuya',     'appliance_meter', 'Ar-condicionado'),
  ('appliance_boiler', 'tuya',     'appliance_meter', 'Boiler');

-- O "caderno" de leituras. ts é o horário da coleta arredondado ao passo de 5 min.
-- Escrita sempre com ON CONFLICT DO NOTHING.
create table public.readings (
  device_id text not null references public.devices (id),
  metric    text not null check (metric in (
              'power_w', 'energy_total_kwh', 'energy_import_total_kwh',
              'energy_export_total_kwh', 'voltage_v')),
  ts        timestamptz not null
              check (ts = date_bin('5 minutes', ts, timestamptz '2000-01-01 00:00:00+00')),
  value     double precision not null,
  primary key (device_id, metric, ts)
);

-- Tradução de código da fonte (ex.: data point Tuya) para métrica interna.
create table public.device_metric_map (
  source      text not null check (source in ('solarman', 'tuya')),
  external_id text not null,
  source_code text not null,
  device_id   text not null references public.devices (id),
  metric      text not null check (metric in (
                'power_w', 'energy_total_kwh', 'energy_import_total_kwh',
                'energy_export_total_kwh', 'voltage_v')),
  scale       double precision not null default 1,
  primary key (source, external_id, source_code)
);

-- Tokens das APIs externas. Só o coletor (service role) lê e grava.
create table public.api_tokens (
  source     text primary key,
  token      text not null,
  expires_at timestamptz
);

create table public.collector_runs (
  id               bigint generated always as identity primary key,
  started_at       timestamptz not null default now(),
  source           text not null,
  ok               boolean not null,
  readings_written int not null default 0,
  error_message    text
);

-- Saldo oficial de créditos informado (manual) ou lido de uma conta de luz.
create table public.credit_baseline (
  as_of       date primary key,
  balance_kwh double precision not null,
  source      text not null default 'manual' check (source in ('manual', 'bill')),
  bill_id     bigint
);

create table public.settings (
  key   text primary key,
  value text not null
);

insert into public.settings (key, value) values
  ('stale_after_minutes', '15'),
  ('solar_low_kwh_per_hour', '0.2'),
  ('credit_trend_days', '8');
