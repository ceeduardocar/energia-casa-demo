---
description: Cria uma migration SQL nova com teste primeiro, seguindo as regras de segurança do Energia
argument-hint: <descrição curta em snake_case>
---

Crie a migration `$ARGUMENTS` seguindo este roteiro, sem pular etapas:

1. Leia `CLAUDE.md` e as migrations mais recentes em `supabase/migrations/` para não repetir nem contradizer nada.
2. Escreva primeiro o teste em `supabase/tests/NN_<nome>.test.sql` (próximo número livre), no formato dos outros:
   `begin;` ... asserções com `test.eq`, `test.is_null`, `test.ok`, `test.throws` ... `rollback;`.
   Inclua pelo menos um teste de permissão: `anon` sem acesso e usuário fora de `private.energy_users` sem linhas.
3. Rode a suíte SQL e confirme que o teste novo FALHA pelo motivo certo.
4. Crie `supabase/migrations/<AAAAMMDDHHMMSS>_<nome>.sql`. Regras:
   - view nova: `with (security_invoker = true)`; tabela nova: RLS ligado e `grant` explícito só ao necessário;
   - nunca `grant` a `anon`; nada que dependa de project-ref, URL ou segredo;
   - dias e horas em `America/Sao_Paulo`; intervalo de energia conta na hora do FIM.
5. Rode a suíte SQL inteira e confirme que tudo passa.
6. Peça ao subagente `revisor-migration` para revisar a migration e o teste antes do commit.

Nunca rode `supabase db push` por este comando: aplicar em produção é decisão do Cesar, depois de conferir
que a CLI está ligada ao project-ref do Energia.
