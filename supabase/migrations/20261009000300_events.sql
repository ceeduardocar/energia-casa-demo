-- Registros que explicam o consumo da casa:
--  carro: uma recarga por dia (started_at = o dia; o kWh vem da medição, não é guardado aqui)
--  piscina: período de bomba ligada (ended_at nulo = ainda ligada; no máximo um aberto)
--  visitas, equipamento, outro: eventos pontuais
create table if not exists public.events (
  id         bigint generated always as identity primary key,
  started_at timestamptz not null,
  ended_at   timestamptz,
  kind       text not null check (kind in ('piscina','visitas','equipamento','carro','outro')),
  label      text,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists events_started_idx on public.events (started_at desc);
create unique index if not exists events_one_open_pool on public.events (kind) where kind = 'piscina' and ended_at is null;
create unique index if not exists events_one_car_per_day on public.events ((timezone('America/Sao_Paulo', started_at)::date)) where kind = 'carro';

alter table public.events enable row level security;
create policy events_select on public.events for select to authenticated using (true);
create policy events_insert on public.events for insert to authenticated with check (true);
create policy events_update on public.events for update to authenticated using (true) with check (true);
create policy events_delete on public.events for delete to authenticated using (true);
revoke all on public.events from anon;
grant select, insert, update, delete on public.events to authenticated;
