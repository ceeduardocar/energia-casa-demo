# Regras de energia usadas pelo assistente

Resumo próprio, escrito para o RAG do assistente (coleção `RegrasEnergia`). As seções 1 a 3 resumem regras
públicas da compensação de energia e da fatura. Não substituem o texto oficial: em caso de dúvida, confira a
Lei 14.300/2022, a Resolução Normativa ANEEL 1.000/2021 e a própria fatura. As seções 4 a 6 são regras deste
sistema, tiradas da spec, das migrations e do `CLAUDE.md`.

## 1. Sistema de compensação de energia (SCEE)

### O que é
Quem tem micro ou minigeração distribuída (como os painéis solares da casa) participa do Sistema de
Compensação de Energia Elétrica. A energia que a casa injeta na rede e não consome na hora vira crédito em kWh
com a distribuidora (Neoenergia Brasília). O crédito abate o consumo da rede no mesmo mês ou em meses seguintes.

### Validade dos créditos
Os créditos de energia valem por 60 meses. Crédito que não é usado nesse prazo expira.

### Base legal
O marco legal da geração distribuída é a Lei 14.300, de janeiro de 2022. As regras de faturamento estão na
Resolução Normativa ANEEL 1.000/2021, que consolidou as regras antigas da REN 482/2012.

### Transição do Fio B
Para quem pediu conexão depois de 7 de janeiro de 2023, uma parte da tarifa de uso da rede (a parcela chamada
Fio B, dentro da TUSD) deixa de ser compensada aos poucos: 15% em 2023, 30% em 2024, 45% em 2025, 60% em 2026,
75% em 2027 e 90% em 2028. Quem pediu antes dessa data tem regra de direito adquirido até 2045. A data do pedido
de conexão da casa não está registrada no sistema; confira com a distribuidora antes de concluir qual regra vale.

## 2. Mínimo faturado (custo de disponibilidade)

### A regra
Todo consumidor do grupo B (residencial) paga um mínimo de energia por mês, mesmo que tenha crédito para cobrir
tudo. O mínimo depende do tipo de ligação: 30 kWh para monofásica, 50 kWh para bifásica e 100 kWh para trifásica.

### Na casa
A conta da casa é "Conv. Monômia - Trifásico": o mínimo faturado é de 100 kWh por mês. Por isso as contas vêm
com "consumo faturado 100 kWh" mesmo quando a casa injetou mais do que consumiu.

### Como entra no cálculo dos créditos
O mínimo não sai dos créditos: compensa-se só o consumo acima dele. Exemplo: a casa consumiu 312 kWh da rede e
injetou 312 kWh. Compensado = 312 − 100 = 212 kWh. Sobram 312 − 212 = 100 kWh para o saldo, e a conta cobra os
100 kWh do mínimo. Esta regra está em `app/credits-months.js` e na view `v_credits`.

## 3. Itens da fatura

### TUSD e TE
A energia é cobrada em duas partes: TUSD (tarifa de uso do sistema de distribuição, o "fio") e TE (tarifa de
energia, a energia em si). As duas aparecem como "Consumo-TUSD" e "Consumo-TE", em kWh.

### Bandeira tarifária
A bandeira (verde, amarela, vermelha patamar 1 ou vermelha patamar 2) é um acréscimo por kWh definido todo mês
pela ANEEL conforme o custo de geração do país. Na fatura aparece como "Acrés. Band." com a cor. Bandeira verde
não tem acréscimo.

### Iluminação pública
"Ilum. Púb. Distrital" é a contribuição de iluminação pública do Distrito Federal. É cobrada na conta de luz, mas
não é energia: créditos de energia não abatem esse valor.

### Juros e multa
Juros e multa de uma conta paga com atraso aparecem na conta seguinte, com o número da nota fiscal antiga.

### Ajuste CAT e energia injetada
Na conta, "ajuste CAT" é o abatimento feito com créditos (aparece negativo). "Energia injetada" é o que a casa
mandou para a rede no ciclo. "Saldo de créditos" é o total acumulado ao fim do ciclo.

## 4. Como o sistema mede a energia

### Fontes
- Geração solar: 2 microinversores Deye, lidos pela API da Solarman.
- Rede: medidor bidirecional de entrada (Tuya).
- Aparelhos: medidor de 2 canais da Tuya, um para o ar-condicionado e outro para o boiler.
- A coleta roda a cada 5 minutos (Edge Function `collect`, agendada pelo pg_cron).

### Fórmulas do dia
- Consumo da casa = geração + importado − exportado.
- Autoconsumo = geração − exportado.
- Autossuficiência = autoconsumo ÷ consumo (0 se o consumo for 0).
- Outros = consumo − ar-condicionado − boiler (nunca negativo).
- Dias e horas no fuso America/Sao_Paulo. Cada intervalo de 5 minutos conta na hora do FIM do intervalo.

### Importado e exportado da rede
Importado e exportado vêm da integração da potência assinada (`power_signed_w`: positivo puxando da rede,
negativo injetando), não dos contadores de energia da Tuya. Os contadores da Tuya inflam a exportação em cerca
de 30%: de 15/10 a 20/10/2026 eles somaram 62,0 kWh importados e 60,9 exportados, contra 55 e 46 da Neoenergia,
enquanto a potência integrada deu 53,7 e 47,0. Lacunas de até 60 minutos são interpoladas.

### Potência
`power_w` é sempre o módulo (nunca negativo). O sentido da rede vem só de `power_signed_w`.

## 5. Créditos no sistema

- O saldo parte do último saldo conhecido (da conta ou informado à mão), soma o exportado e desconta o compensado
  desde aquela data.
- Em cada ciclo de leitura, os primeiros 100 kWh importados são o mínimo faturado e não saem dos créditos.
- A estimativa de duração divide o saldo pelo consumo líquido médio por dia dos últimos dias (importado acima do
  mínimo menos exportado). Só existe quando esse consumo líquido é positivo; se a casa injeta mais do que usa, o
  saldo cresce e não há data para acabar.

## 6. Coleta e qualidade dos dados

### Janelas
- Solarman: só das 06:30 às 18:55 (Brasília). Fora disso o app mostra "Pausa noturna" (com tolerância até 06:45).
- Tuya: 24 horas por dia, porque o consumo maior é à noite.

### Diagnóstico
- Rodada a cada 5 minutos. Mais de 12 minutos sem rodada nova é atraso.
- `ok = false` na última rodada é falha da fonte (por exemplo token vencido, API fora ou limite de chamadas).
- O erro detalhado fica em `collector_runs.error_message`, que o app e o assistente não leem por segurança.

### Falhas conhecidas
- O teste da Tuya IoT Core tem prazo: quando vence, a coleta da Tuya para até ser estendido no painel da Tuya.
- O token da Solarman vale cerca de 60 dias.
- Se os dois contadores da rede chegam com o mesmo horário, o coletor não grava o sinal da potência naquela amostra.
