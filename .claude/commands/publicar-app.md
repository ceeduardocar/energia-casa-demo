---
description: Checklist antes de publicar uma mudança no PWA (app/), que vai para a Vercel pelo master
---

Antes de qualquer merge que mexa em `app/`, confira e mostre o resultado de cada item:

1. `APP_VERSION` e `APP_DATE` subiram em `app/version.js` (o teste `app/tests/version.test.mjs` cobre o formato).
2. Nenhum script inline novo em `app/index.html`, nenhuma URL de CDN externa e o `connect-src` do
   `app/vercel.json` continua só com o Supabase do Energia (`app/tests/security.test.mjs`).
3. `config.js` sem chave nova (só URL e chave anon pública, ou vazio para o modo demonstração).
4. `node --test app/tests/*.test.mjs` passa.
5. Nada de `.env*`, PDF de conta ou dado pessoal no diff (`git diff --stat` e `git diff` do que vai entrar).

Publicar é `git push origin master` e quem faz é o Cesar. Nunca rode `vercel deploy`. $ARGUMENTS
