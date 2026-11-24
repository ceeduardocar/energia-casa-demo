---
name: convencoes-energia
description: Convenções de domínio do Energia Casa (sinais da rede, hora do fim, mínimo faturado, fuso, contadores da Tuya). Use antes de escrever ou revisar SQL, coletor, app ou assistente que calcule energia, créditos ou potência.
---

# Convenções de energia do Energia Casa

Leia antes de tocar em qualquer cálculo. Cada regra tem a fonte de verdade no repositório.

## Unidades e sinais
- Potência em W, energia em kWh. `power_w` é sempre >= 0 (módulo).
- O sentido da rede vem só de `power_signed_w` no `grid_meter`: positivo = puxando da rede, negativo = injetando.
  O coletor usa o contador com timestamp mais recente; com timestamps iguais, não grava sinal.
- Nomes na interface: "Da rede" / "Para a rede", "Puxando da rede" / "Injetando na rede".

## Tempo
- Dias, horas e ciclos no fuso `America/Sao_Paulo`. Leituras em `timestamptz`, arredondadas a 5 min.
- Cada intervalo de energia conta na hora do FIM (igual aos deltas dos contadores).
- Solarman só é coletada das 06:30 às 18:55; o app mostra "Pausa noturna" fora disso (tolerância até 06:45).
  A Tuya roda 24 h.

## Fórmulas
- Consumo = geração + importado − exportado. Autoconsumo = geração − exportado.
- Autossuficiência = autoconsumo ÷ consumo (0 se consumo = 0). Outros = max(consumo − ar − boiler, 0).
- Contador que diminui (troca ou zeragem) conta 0.

## Rede
- Importado e exportado = integração da potência assinada (`v_grid_flow_*` → `v_grid_energy_*`), NÃO os
  contadores da Tuya, que inflam a exportação em ~30% (migration `20261020000100`). Geração e aparelhos usam os
  contadores.

## Créditos
- Mínimo faturado de 100 kWh (ligação trifásica) não sai dos créditos: compensa-se só o consumo acima dele.
  Fonte: `app/credits-months.js` (`MIN_BILLED_KWH`) e `v_credits`. Nunca duplique esta fórmula: importe a função.
- Saldo = último saldo conhecido + exportado − compensado desde aquela data.

## Segurança
- Views com `security_invoker = true`; leitura só para `private.is_energy_user()`; nada para `anon`.
- Energia e Geely são projetos separados: nunca reutilize project-ref, URL, chave, cron ou migration.

## Como aplicar
1. Antes de escrever o cálculo, ache a regra acima e a fonte de verdade citada.
2. Se a regra já existe em código, importe; não reescreva.
3. Escreva o teste com um caso de cada borda: sinal trocado, intervalo cruzando a hora, consumo abaixo do mínimo.
