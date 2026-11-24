-- Atualização imediata pelo app (botão "Atualizado HH:MM"). Rodar À MÃO, depois de cron_collect.sql
-- (usa public.collect_trigger, que depende de pg_net e Vault; não é migration). Idempotente.
--   supabase db query --linked -f supabase/refresh_now.sql
--
-- O app não conhece o segredo do coletor: ele chama esta função, que dispara o mesmo gatilho do pg_cron.
-- Só usuário cadastrado em private.energy_users executa (42501 para os demais). Limite de 30 s entre disparos,
-- para o botão não virar martelada na API da Tuya/Solarman.
-- Mesma definição da migration 20261122192350 (hardening de 22/11/2026): mantenha as duas iguais, senão
-- rodar este arquivo de novo desfaz a verificação de autorização.

create or replace function public.request_collect()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_at timestamptz;
  gap constant interval := interval '30 seconds';
begin
  if not (select private.is_energy_user()) then
    raise exception 'nao autorizado' using errcode = '42501';
  end if;

  select value::timestamptz into last_at from public.settings where key = 'refresh_requested_at';
  if last_at is not null and now() - last_at < gap then
    return jsonb_build_object('started', false, 'wait_s', ceil(extract(epoch from gap - (now() - last_at)))::int);
  end if;

  insert into public.settings (key, value) values ('refresh_requested_at', now()::text)
  on conflict (key) do update set value = excluded.value;

  perform public.collect_trigger();
  return jsonb_build_object('started', true);
end;
$$;

revoke all on function public.request_collect() from public, anon;
grant execute on function public.request_collect() to authenticated;
