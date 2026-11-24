-- Reconcilia no Git o que o hardening de 22/11/2026 aplicou direto em producao e ficou fora
-- de 20261122192350_restrict_energy_access_to_authorized_users.sql. Idempotente: em producao
-- (conferido em 22/11/2026) o resultado e o estado que ja existe; num banco novo, recria-o.
-- Registro: docs/2026-11-22-isolamento-seguranca-supabase.md, secoes 3.1, 3.2 e 3.4.

-- 3.1 Cadastro de usuarios: RLS como defesa em profundidade e leitura so da propria linha.
-- O rls_auto_enable do Supabase so age no schema public, entao precisa ser explicito aqui.
alter table private.energy_users enable row level security;
drop policy if exists energy_users_self_read on private.energy_users;
create policy energy_users_self_read on private.energy_users
for select to authenticated using (user_id = (select auth.uid()));

-- 3.2 Estado dos coletores: o app le so source, ok e started_at (nunca error_message).
-- Desde que v_collector_status passou a security_invoker, a view (e o get_home) leem
-- collector_runs com os privilegios de quem chama; sem este grant dariam permission denied.
revoke all on table public.collector_runs from anon, authenticated;
grant select (source, ok, started_at) on table public.collector_runs to authenticated;

-- 3.4 Funcao do event trigger do Supabase: nenhum papel do app a executa.
-- Condicional porque ela e criada pela plataforma, nao por migration deste repo.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
