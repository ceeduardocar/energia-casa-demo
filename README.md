# EnergyKontrol

> **Cópia pública para avaliação (M4 Capstone).** Este repositório é uma cópia limpa, sem histórico,
> do repositório privado do projeto. Foram retirados o identificador do projeto Supabase, os ids dos
> medidores e da planta solar, e caminhos do computador; o número do medidor das contas de exemplo foi
> trocado. O app publicado aqui abre em **modo demonstração** (dados simulados, sem login, sem banco):
> **https://energia-casa-demo.vercel.app**. A produção real não é acessível a partir desta cópia.
> Como apagar a demonstração depois da avaliação: [`docs/apagar-demo.md`](docs/apagar-demo.md).

Sua energia sob controle.

Sistema pessoal que centraliza a energia da casa (solar, rede, ar-condicionado e
boiler) num PWA sobre o Supabase. Design: `docs/superpowers/specs/2026-10-08-energia-casa-design.md`.

Este repositório contém o PWA estático em `app/`, as migrations SQL em
`supabase/migrations/`, os testes SQL em `supabase/tests/`, as Edge Functions em
`supabase/functions/` e o assistente de energia (LangChain.js + Gemini + RAG no Weaviate) em `agent/`.

## Estado atual

- Produção: PWA na Vercel (URL fora desta cópia). Demonstração: `https://energia-casa-demo.vercel.app`.
- Supabase Energia: projeto `energia-casa`, região `us-west-2` (Oregon).
- Coletores Solarman e Tuya operacionais.
- Isolamento Energia × Geely e reforço de autorização validados em 22/11/2026.
- Registro completo: `docs/2026-11-22-isolamento-seguranca-supabase.md`.

> O hardening de 22/11/2026 está versionado nas migrations `20261122192350` e
> `20261122200000` (esta última traz o que tinha sido aplicado só em produção:
> RLS em `private.energy_users`, grant por coluna em `collector_runs` e o revoke de
> `rls_auto_enable()`). Ainda fora do Git: duas linhas de histórico de migrations do
> Geely no Energia (reparar com `supabase migration repair`) e o papel `claude_ro`.

## Capstone M4: onde está cada requisito

Mapa do enunciado do M4 Capstone ("AI-Augmented Application Development") para os arquivos. A narrativa
completa fica em `docs/capstone-4.md` (PR #5) e o diário de uso de IA em `docs/historico-ia.md`.

| Requisito | Onde está |
|---|---|
| Aplicação funcional | `app/` (PWA, em produção desde 09/10/2026; modo demonstração com `app/config.js` vazio), `supabase/` |
| Código gerado com IA | histórico do Git (`Co-Authored-By: Claude`, `Claude-Session:`); `docs/historico-ia.md` |
| Spec-driven development | `docs/superpowers/specs/` (spec do sistema e do assistente) e `docs/superpowers/plans/` (planos 1 a 4) |
| Skills, comandos e agentes customizados | `.claude/commands/`, `.claude/agents/`, `.claude/skills/`, `.claude/settings.json` |
| Agentes experts com LangChain.js | `agent/src/router.ts`, `agent/src/experts/`, `agent/src/tools/` |
| RAG com busca vetorial no Weaviate | `agent/src/rag/` (`weaviate.ts`: vetores do cliente e busca híbrida), `agent/knowledge/`, `agent/lab/docker-compose.yml` |
| Testes automatizados | `app/tests/`, `supabase/functions/collect/tests/`, `supabase/tests/`, `agent/tests/`; CI em `.github/workflows/ci.yml` |
| Avaliação do assistente | `agent/eval/dataset.json`, `agent/eval/run.ts`, `agent/eval/results/` |
| Refatoração aplicada | views rápidas (`supabase/migrations/20261021000100_fast_views.sql`); `agent/src/format.ts` (formatação que estava copiada em 4 arquivos) |
| Observabilidade | coletor: `collector_runs` e `v_collector_status`; assistente: `agent/src/obs/` (registro por pergunta, `npm run report`, exportação para o painel), amostra em `agent/obs-amostra/`, painel Grafana em `agent/lab/grafana/` |
| Entendimento do que foi gerado | estudos de caso de debug em `docs/capstone-4.md` §4; erros e correções da IA em `docs/historico-ia.md` §2.4; checagem de números em `agent/src/grounding.ts` |
| Histórico de uso de IA | `docs/historico-ia.md` |
| Documentação | este README, `app/README.md`, `agent/README.md`, `CLAUDE.md`, `docs/` |

## Rodar os testes

Precisa de Postgres 15+ (testado no 16 e 17) com `initdb`, `pg_ctl` e `psql`. Se eles não
estiverem no `PATH`, aponte `PG_BIN` para a pasta dos binários (no Windows, os
binários portáteis do Postgres funcionam, rodando os scripts pelo Git Bash).

```bash
export PG_BIN=/caminho/para/pgsql/bin    # opcional
url=$(scripts/local-pg.sh start)         # sobe um Postgres temporário na porta 54329
DATABASE_URL="$url" scripts/test-db.sh   # bootstrap + migrations + testes
scripts/local-pg.sh stop                 # para e apaga os dados
```

`scripts/test-db.sh` só aceita banco vazio: se encontrar `public.readings`, recusa
rodar (proteção contra banco real). Para repetir no mesmo banco de teste, use
`RESET_TEST_DB=1`, que apaga os schemas `public` e `test` antes. Nunca aponte
`DATABASE_URL` para o Supabase.

Cada `*.test.sql` abre uma transação, insere seus dados, faz asserções com as
funções do schema `test` (`test.eq`, `test.is_null`, `test.ok`, `test.throws`) e
termina com `rollback`. O script sai com código diferente de 0 se algo falhar.

## Aplicar no Supabase

No computador do César, com o projeto `energia-casa` já criado no painel do Supabase
(região `us-west-2`, Oregon). Nenhuma chave entra no repositório nem no chat.

1. Instalar a CLI do Supabase (https://supabase.com/docs/guides/cli).
2. `supabase login`.
3. Confirmar que o destino é o projeto Energia, nunca o projeto Geely.
4. `supabase link --project-ref <ref-do-projeto-energia>` (a senha do banco é pedida no terminal).
5. `supabase db push` — aplica as migrations de `supabase/migrations/` em ordem.
6. Só num projeto de **teste**: abrir o editor SQL do painel e rodar
   `supabase/seed_demo.sql` para ter 30 dias de dados simulados. O seed apaga as
   leituras e recusa rodar se o banco já tiver rodadas do coletor.

Depois do push, conferir no painel:

- Authentication → cadastro público desativado;
- usuário criado em Authentication → Users;
- usuário autorizado registrado em `private.energy_users`;
- nenhuma credencial de Geely presente no projeto Energia;
- advisors de segurança, desempenho e saúde revisados.

`supabase/tests/_bootstrap.sql` é só para o banco de teste local; não aplicar no Supabase.

## Segurança e separação dos ambientes

- Energia e Geely usam projetos Supabase, autenticação, segredos, funções e deployments separados.
- O projeto Energia não possui tabelas, funções ou gatilhos de domínio veicular detectáveis por nome.
- `v_collector_status` usa `security_invoker = true` e respeita RLS.
- Somente usuários cadastrados em `private.energy_users` visualizam o status operacional.
- `request_collect()` exige usuário autorizado e limita solicitações a uma a cada 30 segundos.
- `PUBLIC` e `anon` não executam `request_collect()` nem `rls_auto_enable()`.
- O frontend usa apenas chave pública; `service_role` e segredos nunca entram no navegador.

Detalhes, testes executados e pendências: `docs/2026-11-22-isolamento-seguranca-supabase.md`.

## Coletor Solarman

Edge Function `supabase/functions/collect`, chamada pelo `pg_cron` a cada 5 min das
06:30 às 18:55 (Brasília). Grava `power_w` e `energy_total_kwh` da `solar_plant` e,
na mesma rodada, importa 10 dias do histórico da planta até chegar ao início da
operação. Plano: `docs/superpowers/plans/2026-10-09-energia-casa-plano-2-coletor-solarman.md`.

Testes (sem rede, sem Deno): `node --test "supabase/functions/collect/tests/*.test.ts"`.

Publicar (no computador do César; nenhum valor aparece no terminal):

1. Preencher `.env.solarman` (ignorado pelo git) e conferir com `node scripts/solarman-check.mjs`.
2. `supabase db push`.
3. `node scripts/make-supabase-secrets.mjs` e `supabase secrets set --env-file .env.supabase`.
4. `supabase functions deploy collect --no-verify-jwt --use-api`.
5. Editor SQL do painel: rodar `supabase/cron_collect.sql` (agenda e dispara a primeira rodada).

Conferir no editor SQL:

```sql
select started_at, ok, readings_written, error_message from collector_runs order by id desc limit 5;
select * from v_now where device_id = 'solar_plant';
select key, value from settings where key like 'solarman_backfill%';
select day, round(kwh::numeric, 1) from v_energy_daily
where device_id = 'solar_plant' order by day desc limit 10;   -- comparar com o app SOLARMAN Smart
```

## Próximos passos técnicos

1. Marcar como revertidas no histórico do Energia as migrations do Geely `20261113222555` e `20261113223129`, e decidir o destino do papel `claude_ro`.
2. Habilitar proteção contra senhas vazadas no Supabase Auth.
3. Testar em ambiente controlado a mudança de `pg_net` para fora do schema `public`.
4. Avaliar os dois índices de chaves estrangeiras sinalizados pelos advisors.
5. Observar o uso de `energy_hourly_hour_idx` antes de decidir sua remoção.
6. Manter a evolução do coletor Tuya e do PWA conforme os planos do projeto.