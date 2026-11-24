-- Agenda o backfill noturno. Rodar À MÃO (editor SQL do Supabase ou
-- `supabase db query --linked -f supabase/cron_backfill.sql`), depois de cron_collect.sql.
-- Não é migration: usa pg_cron, pg_net e Vault. Idempotente.
--
-- Janela: das 22:00 às 04:55 de Brasília (01:00–07:55 UTC), a cada 5 min, com corpo
-- {"mode":"backfill"}: a função NÃO consulta os dados ao vivo, só avança o backfill.
-- Rodada sem trabalho (backfill concluído ou dia da 1ª leitura ainda aberto) não
-- chama a Solarman nem grava em collector_runs. Depois de solarman_backfill_done,
-- o agendamento pode ser removido: select cron.unschedule('collect-backfill');

create or replace function public.collect_backfill_trigger()
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
    body := '{"mode":"backfill"}'::jsonb,
    timeout_milliseconds := 150000);
$$;
revoke all on function public.collect_backfill_trigger() from public, anon, authenticated;

select cron.unschedule('collect-backfill') where exists (select 1 from cron.job where jobname = 'collect-backfill');
select cron.schedule('collect-backfill', '*/5 1-7 * * *', 'select public.collect_backfill_trigger()');
