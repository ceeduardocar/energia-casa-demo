# Energia Casa — design (spec)

Data: 2026-10-08 · Autor: César Eduardo · Status: para revisão

## 1. Objetivo

Reunir em um único app de celular os dados de energia da casa do César (Brasília):

- **Geração solar**: 2 microinversores Deye com 2 loggers Solarman (nuvem SOLARMAN Smart).
- **Rede (importado e exportado)**: medidor trifásico bidirecional Tuya, na entrada geral.
- **Aparelhos**: medidor Tuya de 2 canais com TC de clipe (canal A = ar-condicionado, canal B = boiler).

O app mostra o agora, o histórico (dia, semana, mês, ano), o consumo por aparelho e o saldo de créditos de energia. Também importa a **conta de luz da Neoenergia** (PDF ou foto) para conferir o que a distribuidora mediu contra o medidor da casa e atualizar o saldo oficial de créditos. Uso pessoal, de um único usuário, sem publicação em loja.

**Critério de sucesso:** abrir o app no celular e ver, com no máximo ~10 minutos de atraso, geração, rede, consumo da casa, ar-condicionado e boiler, com histórico completo a partir da entrada do coletor no ar, sem nenhum computador ou servidor próprio ligado.

## 2. Fora de escopo desta versão

- Leitura local (rede da casa) dos medidores Tuya e dos inversores.
- Push em tempo real da Tuya (Pulsar/MQTT).
- Mais de um usuário.
- Carro elétrico e outros aparelhos (o modelo de dados já os comporta).
- Avisos por notificação (fase opcional, seção 11).
- Cálculo monetário exato de fatura (Fio B, bandeira tarifária, custo de disponibilidade).

## 3. Arquitetura

```
Solarman OpenAPI ─┐
                  ├─► Coletor (Supabase Edge Function, a cada 5 min) ─► Postgres (Supabase)
Tuya Cloud API  ──┘                                                      │
                                                                         ▼
                                                      Views (contas prontas) ◄── App PWA
```

- **Plataforma:** Supabase (Postgres, Edge Functions, `pg_cron`, `pg_net`, Auth, cofre de segredos).
- **Coletor:** uma Edge Function em TypeScript (Deno), acionada a cada 5 minutos por `pg_cron` via `pg_net`.
- **Banco:** uma tabela de leituras com formato único para todas as fontes, mais views que fazem as contas.
- **App:** PWA instalado no celular, lendo apenas as views.
- Nenhum servidor do usuário. Segredos nunca passam pelo app nem por conversas.

## 4. Fontes de dados

### 4.1 Solarman OpenAPI

- Base: `https://globalapi.solarmanpv.com`.
- Autenticação: `POST /account/v1.0/token?appId=...` com `appSecret`, e-mail e senha (senha em SHA-256 minúsculo). O token tem validade longa e é guardado em tabela protegida (seção 6.4).
- Ativação: por e-mail à Solarman (Free Plan do OpenAPI para contas Smart). Limites informados: até 3 plantas e 200 mil chamadas por ano.
- **Estratégia de chamadas:** uma consulta por planta a cada 5 minutos (dados em tempo real da planta), o que dá ~105 mil chamadas por ano, abaixo do limite. Não se consulta cada inversor separadamente por padrão. Leitura por dispositivo fica desligada e só pode ser ligada com intervalo maior (por exemplo 30 min), para não estourar o limite.
- Granularidade real: os loggers enviam dados a cada 5 minutos. Consultar com mais frequência não traz informação nova.
- Dados usados: potência de geração atual (W), energia gerada no dia (kWh), energia total gerada (kWh).
- Histórico de geração dos meses anteriores é importado uma vez (fase 2) pelos endpoints de histórico da planta.

### 4.2 Tuya Cloud API

- Projeto no iot.tuya.com, do tipo Smart Home, no mesmo data center do app Smart Life, com as APIs *IoT Core* e *Authorization Token Management* assinadas e a conta do app vinculada por QR code.
- A assinatura de teste das APIs expira e precisa ser renovada. O coletor registra o erro quando isso acontece (seção 7).
- Autenticação: token do projeto com validade curta, renovado automaticamente e guardado na tabela de tokens.
- Dados lidos de cada dispositivo pelo endpoint **shadow** (`/v2.0/cloud/thing/{id}/shadow/properties`): potência, tensão, corrente e energia acumulada. No medidor trifásico, energia direta e reversa; no medidor de 2 canais, os mesmos valores por canal (`power_a`, `forward_energy_1` etc.). O endpoint de status (`/v1.0/devices/{id}/status`) traz só os totais e não serve para os canais (decisão de 2026-10-12, plano 3).
- **Mapeamento configurável.** Os códigos exatos das propriedades variam entre modelos. O script de descoberta `scripts/tuya-check.mjs` lista o que cada aparelho devolve, e o mapa (`supabase/tuya_map.sql`) preenche a tabela `device_metric_map` (seção 5), que traduz código Tuya em métrica interna. Nenhum código Tuya fica fixo no coletor.
- **Sentido do medidor da rede:** energia *direta* (forward) = importado da rede; energia *reversa* (reverse) = exportado para a rede. Isso é confirmado na instalação e, se estiver invertido, corrige-se só no mapeamento.
- A cota de chamadas do projeto Tuya é verificada no painel. O intervalo de consulta é configurável (padrão 5 min) para respeitá-la.

## 5. Modelo de dados

Todos os horários em `timestamptz` (UTC no banco). Dias, semanas e meses são calculados no fuso `America/Sao_Paulo`.

### Tabelas

**`devices`**: um registro por aparelho ou canal.
- `id` (texto, chave), `source` (`solarman` | `tuya`), `kind` (`solar_plant` | `grid_meter` | `appliance_meter`), `name`, `external_id`.
- Registros previstos: `solar_plant`, `grid_meter`, `appliance_ac` (canal A), `appliance_boiler` (canal B).

**`readings`**: o "caderno" de leituras.
- `device_id`, `metric`, `ts`, `value` (double precision). Chave primária (`device_id`, `metric`, `ts`).
- `ts` é o horário da coleta arredondado para o passo de 5 min.
- Escrita com `ON CONFLICT DO NOTHING`, então rodar duas vezes não duplica.

Métricas internas (unidades fixas):

| metric | unidade | tipo |
|---|---|---|
| `power_w` | W | instantâneo |
| `energy_total_kwh` | kWh | acumulado (hodômetro) |
| `energy_import_total_kwh` | kWh | acumulado, só no `grid_meter` |
| `energy_export_total_kwh` | kWh | acumulado, só no `grid_meter` |
| `voltage_v` | V | instantâneo (opcional) |

**`device_metric_map`**: `source`, `external_id`, `source_code` (código da fonte), `device_id`, `metric`, `scale` (fator de conversão para a unidade interna).

**`api_tokens`**: `source`, `token`, `expires_at`. Acessível só pela função (service role).

**`collector_runs`**: `started_at`, `source`, `ok` (booleano), `readings_written`, `error_message`.

**`credit_baseline`**: `as_of` (data), `balance_kwh`, `source` (`manual` | `bill`), `bill_id` (opcional). Uma linha por conferência com a conta de luz; ao confirmar uma conta, a linha é criada automaticamente com `source = 'bill'`.

**`settings`**: `key`, `value` (por exemplo `tariff_per_kwh`, `stale_after_minutes`, `solar_low_hours`).

**`bills`**: uma linha por conta de luz confirmada (seção 5.1).

### 5.1 Contas de luz (`bills`)

Campos guardados, como impressos na conta da Neoenergia (valores de exemplo da conta de 09/2026):

| Grupo | Campos |
|---|---|
| Identificação | `access_key` (chave de acesso da nota, única), `ref_month` (09/2026), `issue_date`, `due_date`, `meter_number` (1234567), `class` (B1 residencial), `supply_type` (trifásico) |
| Período | `reading_prev_date` (07/08/2026), `reading_curr_date` (09/09/2026), `days` (33), `next_reading_date` (07/10/2026) |
| Medição | `meter_reading_prev` (14.482), `meter_reading_curr` (14.794), `meter_constant` (1,0), `kwh_measured` = (atual − anterior) × constante (312, calculado), `kwh_billed` (100, "Energia Ativa" impressa), `kwh_reactive` (312, "Energia Reativa" impressa, só informativa), `kwh_adjust_cat` (−212), `kwh_injected` (312), `credit_balance_kwh` (2.038,67) |
| Valores (R$) | `tusd_brl`, `te_brl`, `flag_name` (amarela), `flag_brl`, `interest_brl`, `fine_brl`, `public_lighting_brl`, `other_brl` (demais itens somados, ex.: crédito ITAIPU negativo; incluído em 2026-10-09 porque sem ele a soma não fecha), `total_brl` (linha TOTAL dos itens; a 2ª via paga imprime "TOTAL A PAGAR 0,00") |
| Histórico | `consumption_history` (13 meses de consumo faturado e dias, da tabela impressa na conta) |
| Controle | `file_path` (arquivo no armazenamento privado), `extraction_method` (`pdf_text` | `vision`), `confirmed_at` |

**Não são guardados:** CPF, nome, endereço, número da unidade consumidora, códigos de barras e QR codes.

**Verificações de consistência** feitas na importação (qualquer falha destaca o campo na tela de conferência):
- `kwh_measured + kwh_adjust_cat = kwh_billed` (312 − 212 = 100).
- Soma das linhas de valores = `total_brl` (135,40).
- `days` = diferença entre as datas de leitura (33).
- Datas coerentes (leitura anterior < atual < próxima).
- `access_key` ainda não importada (evita duplicata).

Os campos de consumo e injetado são guardados exatamente como impressos; a interpretação (por exemplo, se a linha "Energia Reativa" é de fato reativa) fica na tela de conferência, onde o usuário confirma, e não no código.

### Views (as "contas prontas")

Todas lidas só pelo usuário autenticado (seção 6).

- **`v_now`**: última leitura de cada `device_id` e `metric`, com idade em minutos.
- **`v_energy_hourly`**: energia por hora e por aparelho. Para métricas acumuladas, é a diferença do hodômetro entre o fim e o início de cada hora; diferenças negativas (contador zerado ou aparelho trocado) contam como 0. Para potência, é a média da hora.
- **`v_energy_daily`**: o mesmo por dia no fuso de Brasília. Semana, mês e ano são somas desta view (o app agrupa).
- **`v_house_daily`**: por dia, com `g` = geração, `i` = importado, `e` = exportado:
  - `consumo = g + i − e`
  - `autoconsumo = g − e`
  - `autossuficiencia = autoconsumo ÷ consumo` (0 se consumo = 0)
  - `ar = energia do appliance_ac`, `boiler = energia do appliance_boiler`
  - `outros = max(consumo − ar − boiler, 0)`
- **`v_credits`**: `saldo = balance_kwh do último credit_baseline + exportado − importado` desde `as_of`. Estimativa de duração = saldo ÷ média diária de (importado − exportado) dos últimos 8 dias, quando essa média for positiva.
- **`v_collector_status`**: para cada fonte, a última rodada do coletor (`ok`, `started_at`, idade em minutos), sem `error_message`. É a única forma de o app ver o estado do coletor.
- **`v_boiler_off_sun`**: energia do boiler nas horas de baixa geração (geração da hora abaixo de um limite em `settings`), por dia. Alimenta o aviso da tela Aparelhos.
- **`v_bill_check`**: para cada conta confirmada, compara o período de leitura da distribuidora (`reading_prev_date` a `reading_curr_date`) com o medidor da casa: importado do `grid_meter` × `kwh_measured` e exportado do `grid_meter` × `kwh_injected`, com diferença em kWh e em %. Só calcula quando as leituras cobrem pelo menos 99% do período (conta de contagem de leituras esperadas); caso contrário o status é "sem cobertura" (por exemplo, ciclos anteriores à entrada do coletor). Marca "atenção" quando a diferença passa do limite em `settings` (padrão 5%). Diferenças pequenas (1 a 3%) são esperadas, porque são medidores diferentes e as datas de leitura não coincidem exatamente com a meia-noite.

**Saldo de créditos é uma estimativa.** Ele não replica regras da concessionária (custo de disponibilidade, Fio B, validade). Por isso existe `credit_baseline`: a cada conta de luz o usuário informa o saldo oficial, e o app volta a partir dele.

## 6. Segurança

1. **Segredos** da Solarman (`appId`, `appSecret`, e-mail, senha) e da Tuya (`client_id`, `secret`) ficam no cofre de segredos do Supabase, lidos só pela Edge Function. Nunca estão no código, no repositório, no app nem em conversas.
2. **RLS (acesso por linha)** ligado em todas as tabelas. O usuário autenticado (um só) lê as views e as tabelas `credit_baseline` e `settings`, e grava `credit_baseline` e `settings`. Ninguém escreve em `readings`, exceto a função (service role).
3. **Cadastro de novos usuários desligado** no Supabase Auth. Existe um único usuário.
4. O app usa a chave pública (`anon`) com o login. A chave `service_role` nunca sai do servidor.
5. `api_tokens` e `collector_runs` não são legíveis pelo app. O status do coletor chega ao app só pela view `v_collector_status` (seção 5), que mostra a última rodada de cada fonte (ok ou erro e idade em minutos) sem a mensagem de erro.
6. **Contas de luz:** os arquivos ficam num bucket privado do Supabase Storage, com acesso só ao usuário autenticado. A configuração `keep_bill_files` (padrão: guardar) permite apagar o arquivo depois da confirmação, mantendo só os campos. A chave de API do modelo de visão (se usada, seção 7.1) fica no cofre de segredos e só a função a lê.

## 7. Coletor

- Edge Function única `collect`, acionada a cada 5 minutos por `pg_cron` + `pg_net`.
- Cada fonte roda de forma independente, em sequência, com tempo limite próprio. Falha em uma não impede a outra.
- Para cada fonte: obtém token válido (renova se faltar menos de 10 minutos), consulta, converte pelo `device_metric_map`, valida, grava com `ON CONFLICT DO NOTHING` e registra uma linha em `collector_runs`.
- **Validação:** descarta e registra valores negativos de potência, potência acima de um teto por aparelho (configurável) e acumulado que diminui em relação à leitura anterior. A diferença negativa de acumulado é tratada nas views (seção 5), e a leitura continua gravada.
- **Renovação de token:** se a Tuya devolver erro de token, renova uma vez e tenta de novo. Se a assinatura do projeto expirou, registra `error_message` claro e segue.
- **Idempotência:** o mesmo `ts` arredondado não gera linha duplicada.
- **Backfill da Solarman:** função separada, executada uma vez à mão, que importa o histórico da planta.

### 7.1 Importação da conta de luz

- **Decisão de 2026-10-09:** a leitura do PDF com texto é feita **no próprio aparelho** (pdf.js, `app/billparse.js`), em vez de uma função `parse_bill` no servidor. O arquivo não sai do celular e não há função para publicar. PDF com senha: o app pede a senha na hora e não a guarda. A função no servidor fica só para fotos (modelo de visão), numa fase posterior.
- **PDF com texto** (caso da conta digital da Neoenergia): extração por regras sobre o texto, sem custo e sem IA. Regras validadas com as contas reais de 05 a 09/2026. Verificação extra útil: saldo da conta = saldo da anterior + injetado + ajuste CAT.
- **Foto ou PDF sem texto:** extração por modelo de visão, usando uma chave de API do usuário guardada no cofre. Custo estimado em centavos por conta. Se a chave não estiver configurada, o app só oferece o preenchimento manual dos campos.
- O resultado nunca é salvo direto: vai para a **tela de conferência**, com os campos lidos, as verificações de consistência (seção 5.1) e a edição de qualquer valor. Só a confirmação do usuário grava em `bills`.
- Ao confirmar: cria a linha em `credit_baseline` (`source = 'bill'`, `as_of = reading_curr_date`, saldo da conta) e importa a tabela de histórico de 13 meses para `bills.consumption_history`.

## 8. App (PWA)

Instalado no celular a partir do navegador. Tema "Ciano holográfico". As telas já estão desenhadas no canvas do projeto, na linha "A2" (artifact "App Energia Solar - Opções de Tela", no claude.ai).

| Tela | Fonte | Atualização |
|---|---|---|
| Início ("Agora") | `v_now`, `v_energy_hourly` do dia, `v_house_daily` de hoje | a cada 60 s com o app aberto |
| Aparelhos | `v_house_daily`, `v_energy_hourly` por aparelho, `v_boiler_off_sun` | ao abrir e a cada 60 s |
| Histórico (dia, semana, mês, ano) | `v_energy_daily`, `v_house_daily` agrupadas | ao abrir e ao trocar o período |
| Créditos | `v_credits` | ao abrir |
| Contas de luz | `bills`, `v_bill_check` | ao abrir e após importar |
| Ajustes | `devices`, `v_collector_status`, `settings`, `credit_baseline` | ao abrir |

- **Login** por e-mail e senha (ou link por e-mail) do Supabase Auth. A sessão fica no navegador.
- **Dados antigos:** se a última leitura de uma fonte for mais velha que `stale_after_minutes` (padrão 15), a tela mostra "dados de há X min" no lugar de um número parado.
- **Offline:** o app mostra o último resultado em cache e avisa que está sem conexão.
- **Sem chaves de API** no app. Ele só fala com o Supabase.
- O app indica "Dados de exemplo" enquanto estiver ligado a dados de teste (fase 1 e 4).

## 9. Falhas e casos limite

- Solarman ou Tuya fora do ar: a rodada registra o erro, a outra fonte continua, e o app mostra "dados de há X min" para a que parou.
- Rodada atrasada ou repetida: a escrita idempotente evita duplicatas; um buraco curto é coberto porque o acumulado já traz o total certo.
- Contador zerado, aparelho trocado ou medidor reinstalado: diferença negativa vale 0; a leitura fica marcada.
- Sentido invertido do medidor da rede (importado × exportado): corrigido no `device_metric_map` (campo `scale` negativo ou troca de métrica), sem mexer em código.
- Assinatura de teste da Tuya vencida: erro claro em `collector_runs`, aviso no app (Ajustes e Início).
- Fuso e horário de verão: cálculos de dia usam `America/Sao_Paulo`.
- Dia sem dados de uma fonte: a view devolve nulo para essa fonte, e o app mostra "—" em vez de zero.

## 10. Testes

- **Contas das views** (SQL, no Postgres de testes): conjuntos de leituras com resultado conhecido, incluindo: dia normal (g = 9,8, i = 4,5, e = 3,1 → consumo 11,2, autoconsumo 6,7, autossuficiência 60%), contador que zera, buraco de leituras, virada de dia no fuso de Brasília, saldo de créditos a partir de uma linha base e "Outros" nunca negativo.
- **Coletor** (testes automatizados): respostas simuladas das APIs da Solarman e da Tuya cobrindo sucesso, token expirado, erro de rede, valor fora da faixa, resposta com campo faltando e independência entre as fontes.
- **Contas de luz:** a conta de 09/2026 como caso de teste real (extração de texto do PDF e conferência dos campos), casos de falha de consistência (soma errada, datas fora de ordem, conta repetida) e `v_bill_check` com cobertura completa, cobertura parcial e diferença acima do limite.
- **Mapeamento Tuya:** teste com respostas reais salvas na fase 3, para garantir que cada código vira a métrica certa.
- **App:** conferência dos números da tela contra o resultado das views com os dados de teste.
- **Fim a fim com contas reais:** só na fase 2 (Solarman) e na fase 3 (Tuya), no computador do usuário, com as chaves reais.

## 11. Fases e critérios de aceite

1. **Banco e views com dados de teste.** Critério: as views devolvem os números esperados dos testes, e o app mostra as telas com dados simulados.
2. **Coletor Solarman.** Depende da ativação da API pela Solarman. Critério: geração real gravada a cada 5 minutos por 24 horas sem buracos; histórico de meses anteriores importado.
3. **Coletor Tuya.** Depende dos medidores instalados e vinculados. Critério: potência e energia da rede, do ar-condicionado e do boiler gravadas por 24 horas; mapeamento conferido (importado × exportado) contra o relógio medidor. *Registro (2026-10-12): coletor no ar a cada 5 min nas 24 horas, medidores vinculados e mapeados (plano 3). Aceite de 24 horas e conferência do sentido contra o relógio: pendentes.*
4. **App.** Construído sobre as views, trocando dados de teste por reais conforme as fases 2 e 3. Ordem: Início, Histórico, Aparelhos, Créditos, Ajustes.
5. **Contas de luz.** Tabela `bills`, `parse_bill`, tela de envio e conferência e `v_bill_check`. Critério: a conta de 09/2026 é importada com todas as verificações de consistência passando (312 − 212 = 100, soma = R$ 135,40, 33 dias), o saldo de 2.038,67 kWh vira o ponto de partida dos créditos, e a tabela de 13 meses é importada. O comparativo com o medidor da casa só passa a ter valor a partir do primeiro ciclo completo gravado pelo coletor.
6. **Avisos (opcional).** Saldo baixo, geração parada, resumo diário, diferença grande na conta.

**Divisão de ambientes:** o código, os testes com dados simulados e o repositório são feitos na sessão de desenho. A publicação no Supabase e os testes com chaves reais são feitos no computador do usuário (com o Claude Code e a CLI do Supabase), para que nenhuma chave passe por conversa.

## 12. Premissas e riscos

- A API da Solarman ainda precisa ser ativada por e-mail; até lá não há geração real no banco.
- Os medidores Tuya ainda não estão instalados. O mapeamento exato de códigos e o sentido direta/reversa são confirmados só na fase 3.
- Os dois microinversores estão na mesma planta Solarman ("Casa de exemplo"). Se estiverem em plantas separadas, o coletor consulta cada planta (continua dentro do limite de chamadas).
- O histórico de importado, exportado, ar-condicionado e boiler começa no dia em que o coletor entra no ar; a nuvem da Tuya guarda pouco histórico.
- A cota de chamadas e a assinatura do projeto Tuya podem impor limites ou renovação periódica.
- O volume é de cerca de 10 linhas por rodada, ou ~3 mil por dia (~1 milhão por ano), o que é pequeno para o plano gratuito do Supabase. O limite de armazenamento do plano é conferido na criação do projeto; se o uso se aproximar dele, leituras antigas de 5 minutos são agregadas por hora e as originais removidas.
- O saldo de créditos é uma estimativa conferida a cada conta de luz (seção 5).
- O layout da conta da Neoenergia pode mudar; a extração por regras precisa de ajuste nesse caso, e a conferência manual evita gravar valor errado.
- A conta traz dados pessoais; por isso apenas os campos listados em 5.1 são guardados e o arquivo fica em armazenamento privado.
- A interpretação das linhas "Energia Ativa" e "Energia Reativa" e da energia injetada na conta é confirmada pelo usuário na conferência da primeira conta importada.
