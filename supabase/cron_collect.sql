-- Agenda o coletor. Rodar À MÃO no editor SQL do Supabase (não é migration: usa
-- pg_cron, pg_net e Vault, que o Postgres de testes não tem). Idempotente.
--
-- A cada 5 min, nas 24 horas (o pg_cron usa UTC). A Tuya coleta de dia e de noite.
-- A janela da Solarman (06:30 às 18:55 de Brasília) fica dentro da função: fora dela
-- a fonte solarman não roda ao vivo e não grava em collector_runs.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Segredo do gatilho: gerado aqui no Vault, nunca sai do banco.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'collect_secret',
                           'cabeçalho x-collect-secret do coletor')
where not exists (select 1 from vault.secrets where name = 'collect_secret');

-- A função collect confere o cabeçalho por aqui (só o service_role executa).
create or replace function public.collect_secret_ok(s text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'collect_secret' and decrypted_secret = s);
$$;
revoke all on function public.collect_secret_ok(text) from public, anon, authenticated;
grant execute on function public.collect_secret_ok(text) to service_role;

-- Chamada da função (usada pelo agendamento e pelo disparo manual abaixo).
create or replace function public.collect_trigger()
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/collect',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-collect-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'collect_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000);
$$;
revoke all on function public.collect_trigger() from public, anon, authenticated;

select cron.unschedule('collect') where exists (select 1 from cron.job where jobname = 'collect');
select cron.schedule('collect', '*/5 * * * *', 'select public.collect_trigger()');

-- Primeira rodada agora (o resultado aparece em collector_runs em alguns segundos).
select public.collect_trigger();
