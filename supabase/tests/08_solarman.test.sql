-- Coletor Solarman: ajustes padrão e permissões que ele depende.
begin;
-- sessao do usuario autorizado (auth.uid()); ver test.energy_user() no _bootstrap.sql
select set_config('request.jwt.claim.sub', test.energy_user(), true);

select test.ok('solar_max_power_w = 6000',
  (select value = '6000' from settings where key = 'solar_max_power_w'));
select test.ok('backfill ligado por padrão',
  (select value = 'true' from settings where key = 'solarman_backfill_enabled'));
select test.ok('backfill 10 dias por rodada',
  (select value = '10' from settings where key = 'solarman_backfill_days_per_run'));
select test.eq('cursor do backfill ainda não existe',
  (select count(*) from settings
   where key in ('solarman_backfill_cursor', 'solarman_backfill_base', 'solarman_backfill_done')), 0);

-- regressão: o app continua sem ver os tokens
set local role authenticated;
select test.throws('authenticated não lê api_tokens', 'select * from api_tokens');
reset role;

rollback;
