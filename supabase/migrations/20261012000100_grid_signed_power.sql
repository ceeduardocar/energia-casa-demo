-- Preserva o sentido instantâneo informado pelo medidor bidirecional Tuya.
-- Convenção: positivo = rede -> casa (importação); negativo = casa -> rede (injeção).
-- power_w continua sendo o módulo para compatibilidade com clientes existentes.
alter table public.readings drop constraint readings_metric_check;
alter table public.readings add constraint readings_metric_check check (metric in (
  'power_w', 'power_signed_w', 'energy_total_kwh', 'energy_import_total_kwh',
  'energy_export_total_kwh', 'voltage_v'
));

