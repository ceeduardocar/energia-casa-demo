-- Preparação do banco de TESTE (nunca aplicar no Supabase real).
-- Cria os papéis do Supabase, imita os privilégios padrão que o Supabase
-- concede a eles e define as funções de asserção no schema `test`.
-- Idempotente.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- Como no Supabase: os três papéis usam o schema public e recebem, por padrão,
-- acesso total a tudo que for criado nele. A migration de segurança revoga.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;

-- Como no Supabase: schema auth com auth.users e auth.uid() lendo o "sub" do JWT
-- (aqui, a configuracao request.jwt.claim.sub da transacao). Uma unica conta de teste,
-- criada antes das migrations, para que a migration de autorizacao a cadastre sozinha.
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (
  id uuid primary key
);
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000e001')
on conflict do nothing;
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to public;

-- Como no Supabase: funcao do event trigger que liga RLS em tabelas novas
-- (aqui so um esboco; os testes conferem quem pode executa-la).
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
as $$
begin
end;
$$;

create schema if not exists test;
grant usage on schema test to public;

create or replace function test.eq(label text, actual numeric, expected numeric, tol numeric default 0.0001)
returns void language plpgsql as $$
begin
  if actual is null or expected is null or abs(actual - expected) > tol then
    raise exception 'FAIL: %: got % expected %', label, coalesce(actual::text, 'NULL'), coalesce(expected::text, 'NULL');
  end if;
end
$$;

create or replace function test.is_null(label text, actual anyelement)
returns void language plpgsql as $$
begin
  if actual is not null then
    raise exception 'FAIL: %: got % expected NULL', label, actual;
  end if;
end
$$;

create or replace function test.ok(label text, cond boolean)
returns void language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'FAIL: %: condition is %', label, coalesce(cond::text, 'NULL');
  end if;
end
$$;

create or replace function test.throws(label text, sql text)
returns void language plpgsql as $$
declare
  failed boolean := false;
begin
  begin
    execute sql;
  exception when others then
    failed := true;
  end;
  if not failed then
    raise exception 'FAIL: %: no error', label;
  end if;
end
$$;

grant execute on all functions in schema test to public;

-- Usuario de teste cadastrado em private.energy_users e um segundo, sem cadastro.
create or replace function test.energy_user() returns text language sql immutable
as $$ select '00000000-0000-0000-0000-00000000e001' $$;
create or replace function test.stranger() returns text language sql immutable
as $$ select '00000000-0000-0000-0000-00000000e002' $$;
grant execute on all functions in schema test to public;
