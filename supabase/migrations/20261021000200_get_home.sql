-- Tela Início em uma chamada: antes eram 6 consultas (v_now, v_collector_status, v_house_hourly,
-- v_self_consumption_daily, events do dia e bomba aberta), duas delas em sequência, cada uma
-- com ~200 ms de ida e volta até o Supabase (Oregon). security invoker: vale o RLS de quem chama.

create function public.get_home(p_day date) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'now', coalesce((select jsonb_agg(to_jsonb(n)) from public.v_now n), '[]'::jsonb),
    'status', coalesce((select jsonb_agg(to_jsonb(s)) from public.v_collector_status s), '[]'::jsonb),
    'hourly', coalesce((select jsonb_agg(to_jsonb(h) order by h.hour_local) from public.v_house_hourly h
                        where h.hour_local >= p_day::timestamp and h.hour_local < (p_day + 1)::timestamp), '[]'::jsonb),
    'self', coalesce((select jsonb_agg(to_jsonb(c)) from public.v_self_consumption_daily c where c.day = p_day), '[]'::jsonb),
    'car', exists (select 1 from public.events e
                   where e.kind = 'carro'
                     and e.started_at >= (p_day::timestamp at time zone 'America/Sao_Paulo')
                     and e.started_at < ((p_day + 1)::timestamp at time zone 'America/Sao_Paulo')),
    'pool', (select to_jsonb(e) from public.events e where e.kind = 'piscina' and e.ended_at is null limit 1)
  );
$$;
revoke all on function public.get_home(date) from public, anon;
grant execute on function public.get_home(date) to authenticated;
