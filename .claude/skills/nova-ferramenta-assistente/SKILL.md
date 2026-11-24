---
name: nova-ferramenta-assistente
description: Roteiro para adicionar uma ferramenta nova a um expert do assistente de energia (agent/), com teste primeiro, esquema zod, fonte e registro. Use quando o assistente precisar responder um tipo novo de pergunta com números.
---

# Nova ferramenta no assistente de energia

O assistente só diz números que vieram de ferramenta. Uma pergunta nova com número precisa de ferramenta nova
(ou de um campo novo numa existente). Siga a ordem.

## 1. Defina o contrato
- Nome em snake_case e português (`resumo_dia`, `status_coleta`).
- Entrada: `z.object({...})` com `.describe()` em português em cada campo. Datas como `AAAA-MM-DD`.
- Saída: JSON pequeno, campos com unidade no nome (`_kwh`, `_pct`, `_min`), números arredondados a 2 casas,
  e sempre o campo `fonte` (a view ou função de onde veio).
- Falta de dado é `{ erro: "...", fonte }`, nunca exceção.

## 2. Teste primeiro
Em `agent/tests/tools.test.ts`, com `fixedProvider` de `tests/helpers.ts` (dados montados à mão) ou
`demoProvider()` (valores conferidos contra `app/demo.js`). Rode `cd agent && node --test tests/tools.test.ts` e veja
o teste falhar.

## 3. Implemente
- Arquivo em `agent/src/tools/`. Leia dados só pelo `DataProvider` (`src/data/provider.ts`); se precisar de um
  dado novo, acrescente o método nas duas implementações (`demo.ts` e `postgres.ts`) e só com `select`.
- Reaproveite as funções puras do app (`app/util.js`, `app/credits-months.js`, `app/bills.js`) em vez de reescrever.

## 4. Ligue ao expert
- Registre em `createAssistant` (`src/assistant.ts`) e acrescente o nome em `ferramentas` do expert certo
  (`src/experts/definitions.ts`), com uma regra no prompt dizendo quando usar.
- Se a ferramenta muda a rota, ajuste as palavras-chave de reserva em `src/router.ts` e o teste do roteador.

## 5. Avaliação
- Acrescente pelo menos uma pergunta em `agent/eval/dataset.json` com `expert`, `ferramentas` e `numeros`.
- Ensine a política offline (`src/offline-policy.ts`) a chamar a ferramenta, ou marque o item com
  `"offline": false` se ele só fizer sentido com o Gemini.
- Rode `npm test` e `npm run eval:offline`. Peça revisão ao subagente `revisor-assistente`.
