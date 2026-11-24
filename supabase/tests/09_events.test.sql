-- Eventos que explicam o consumo: restricoes de carro e piscina, RLS e permissoes.
begin;
-- sessao do usuario autorizado (auth.uid()); ver test.energy_user() no _bootstrap.sql
select set_config('request.jwt.claim.sub', test.energy_user(), true);

select test.ok('events com RLS ligado',
  (select relrowsecurity from pg_class where oid = 'public.events'::regclass));
select test.ok('anon sem nenhum privilegio em events',
  not has_table_privilege('anon', 'public.events', 'select,insert,update,delete'));

set local role authenticated;
-- carro: uma recarga por dia local (America/Sao_Paulo)
insert into events (kind, started_at) values ('carro', '2026-10-09 12:00-03');
select test.throws('segunda recarga no mesmo dia',
  $$insert into events (kind, started_at) values ('carro', '2026-10-09 23:30-03')$$);
insert into events (kind, started_at) values ('carro', '2026-10-10 00:30-03');
select test.eq('recarga no dia seguinte aceita', (select count(*) from events where kind = 'carro'), 2);

-- piscina: no maximo um periodo aberto (ended_at nulo)
insert into events (kind, started_at) values ('piscina', '2026-10-01 08:00-03');
select test.throws('segunda bomba aberta',
  $$insert into events (kind, started_at) values ('piscina', '2026-10-05 08:00-03')$$);
update events set ended_at = '2026-10-04 18:00-03' where kind = 'piscina';
insert into events (kind, started_at) values ('piscina', '2026-10-05 08:00-03');
select test.eq('nova bomba depois de fechar a anterior',
  (select count(*) from events where kind = 'piscina'), 2);
select test.throws('fim antes do inicio',
  $$insert into events (kind, started_at, ended_at) values ('outro', '2026-10-05 08:00-03', '2026-10-04 08:00-03')$$);
select test.throws('tipo invalido',
  $$insert into events (kind, started_at) values ('festa', '2026-10-05 08:00-03')$$);

set local role anon;
select test.throws('anon nao le events', 'select * from events');
select test.throws('anon nao grava events',
  $$insert into events (kind, started_at) values ('outro', now())$$);

rollback;
