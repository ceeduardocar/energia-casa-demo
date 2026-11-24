---
description: Faz uma pergunta ao assistente de energia (LangChain.js + RAG) no laboratório local
argument-hint: <pergunta em português>
---

Rode, de dentro de `agent/`:

`node src/cli.ts --data ${DATA:-demo} --store ${STORE:-memory} "$ARGUMENTS"`

- Sem `GEMINI_API_KEY` no `agent/.env`, o CLI avisa e para. Não peça a chave no chat; o Cesar coloca no `.env`.
- Mostre a resposta, o expert escolhido, as ferramentas chamadas e o resultado da checagem de números
  (o registro da pergunta fica em `agent/logs/`).
- Se a checagem apontar número sem fonte, diga qual número e de onde ele deveria ter vindo.
