---
description: Roda todas as suítes de teste do Energia Casa (app, coletor, SQL e assistente) e resume o resultado
allowed-tools: Bash(node --test:*), Bash(scripts/local-pg.sh:*), Bash(scripts/test-db.sh), Bash(npm test), Bash(npm run eval:offline)
---

Rode as quatro suítes, nesta ordem, e pare para investigar na primeira que falhar.

1. App: `node --test app/tests/*.test.mjs`
2. Coletor: `node --test "supabase/functions/collect/tests/*.test.ts"`
3. Banco: `url=$(scripts/local-pg.sh start); DATABASE_URL="$url" scripts/test-db.sh; scripts/local-pg.sh stop`
   (no Windows, antes: `export PG_BIN=$HOME/tools/pg17/pgsql/bin`). Sempre pare o Postgres no fim, mesmo se falhar.
4. Assistente: `cd agent && npm test && npm run eval:offline`

Responda com uma linha por suíte: nome, passou/falhou, quantidade de testes. Para cada falha, o nome do teste,
a linha decisiva do erro e a hipótese de causa. Não altere código neste comando: se houver falha, proponha a
correção e pergunte antes. $ARGUMENTS
