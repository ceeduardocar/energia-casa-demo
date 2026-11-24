# Energia Casa - contexto para o Claude Code

Sistema pessoal do Cesar (Brasilia) que centraliza energia da casa num PWA:
solar (2 microinversores Deye via Solarman), medidor bidirecional de entrada (Tuya),
medidor 2 canais de ar-condicionado e boiler (Tuya), creditos e conta de luz Neoenergia.

## Leia primeiro
- Spec aprovada: docs/superpowers/specs/2026-10-08-energia-casa-design.md
- Plano 1 (banco + views): docs/superpowers/plans/2026-10-08-energia-casa-plano-1-banco.md
- Auditoria de isolamento e seguranca (22/11/2026): docs/2026-11-22-isolamento-seguranca-supabase.md

## Estado
- Isolamento e hardening (2026-11-22): removidos do Supabase Energia 9 tabelas vazias, 3 funcoes privadas e 1 gatilho
  de dominio veicular. Validacao atual: 0 tabelas, 0 funcoes e 0 gatilhos `vehicle%` no Energia; projeto Geely nao alterado.
  Foi criado `private.energy_users` (1 usuario autorizado), `v_collector_status` passou a `security_invoker=true`,
  a leitura de `collector_runs` ficou limitada a `source`, `ok` e `started_at`, `request_collect()` passou a validar
  `auth.uid()` e manter rate limit de 30 s, e `rls_auto_enable()` deixou de ser executavel por anon/authenticated.
  Testes em producao: usuario autorizado le 2 estados e executa refresh; usuario nao cadastrado ve 0 linhas e recebe
  SQLSTATE 42501; Solarman e Tuya permaneceram com `ok=true`; health advisor sem alertas. As mudancas foram aplicadas
  diretamente em producao e depois versionadas: 20261122192350 (allowlist, policies, security_invoker, request_collect) e
  20261122200000 (RLS em private.energy_users, grant por coluna em collector_runs, revoke de rls_auto_enable), conferidas
  contra producao em 22/11/2026. Fora do Git: linhas de historico 20261113222555/20261113223129 (Geely) no Energia e o papel
  `claude_ro` (policies ro_read). Testes locais simulam auth.users/auth.uid() no _bootstrap.sql (test.energy_user()).
  Registro completo no documento de auditoria.
- Plano 1 implementado (tarefas 1-9), testes SQL passando no Postgres 16 e 17. Migrations aplicadas no Supabase
  em 2026-10-08 (supabase db push); conferido que anon recebe "permission denied" em tabelas e views.
  Sem dados ainda (seed_demo nao rodado no projeto real).
- API Solarman ativada e testada em 2026-10-09 (`node scripts/solarman-check.mjs`, chaves em .env.solarman, ignorado).
  Uma planta "Casa de exemplo" (stationId omitido nesta copia): 2 COLLECTOR + 2 MICRO_INVERTER. Token valido ~60 dias.
  realTime traz generationPower (W) e generationTotal (kWh), mas NAO traz energia do dia: usar historico ou diferenca do total.
- Coletor Solarman (plano 2, tarefas 1-8) NO AR desde 2026-10-09 06:51: Edge Function `collect`, pg_cron `*/5 10-21 * * *`
  UTC (07:00-18:55 Brasilia), segredo do gatilho gerado no Vault (`collect_secret`, conferido por public.collect_secret_ok).
  Testes: `node --test "supabase/functions/collect/tests/*.test.ts"`. SQL no projeto: `supabase db query --linked "..."`.
  Backfill do historico comeca no dia seguinte a 1a leitura (2026-10-10, a partir de 00:00) e leva ~1 dia; progresso em settings solarman_backfill_*.
  Alem das rodadas do dia, roda a noite (cron `collect-backfill`, `*/5 1-7 * * *` UTC = 22:00-04:55, supabase/cron_backfill.sql) com
  corpo {"mode":"backfill"}: sem coleta ao vivo e sem linha em collector_runs quando nao ha trabalho. Pode ser removido apos solarman_backfill_done.
- PLANO 3 (Tuya): os medidores rodam 24 h (consumo maior e a noite). Ao incluir a Tuya, o cron passa a `*/5 * * * *`
  e a janela vira regra da fonte solarman dentro da funcao (pular a Solarman fora dela). O app ja so
  aplica "Pausa noturna" a source solarman. Janela atual: 06:30-18:55 Brasilia (inicio mudou de 07:00 em 2026-10-19;
  o app mostra "Pausa noturna" ate 06:45, 15 min de tolerancia). O historico acima (07:00-18:55) era o cron antigo.
- PLANO 3: generalizar aparelhos (Cesar quer poder somar medidores individuais). Hoje v_house_hourly/daily tem
  colunas fixas ac/bo e o app procura appliance_ac/appliance_boiler (app.js). Proposta: view por aparelho
  (qualquer appliance_meter), Outros = consumo - soma dos aparelhos, tela Aparelhos lida de `devices`.
  Novo aparelho = linha em devices + device_metric_map, sem codigo. Perguntar quantos medidores e o que medem.
- Falta: conferir backfill contra o app SOLARMAN Smart (tarefa 8 passos 6-7) e tarefa 9 (registrar as decisoes na spec).
- Testes: `url=$(scripts/local-pg.sh start); DATABASE_URL="$url" scripts/test-db.sh; scripts/local-pg.sh stop`.
  No Windows deste PC: `export PG_BIN=$HOME/tools/pg17/pgsql/bin` (Postgres 17 portatil, mesma versao do projeto;
  o 16 fica em $HOME/tools/pgsql/bin) e rodar pelo Git Bash.
- Projeto Supabase criado: energia-casa, ref <PROJECT_REF>, regiao us-west-2 (Oregon, decisao do Cesar em
  2026-10-08: manter, apesar da spec pedir Sao Paulo), Postgres 17. CLI instalada via scoop.
- Convencao: `power_w` continua sempre >= 0 (modulo). O `power_total` do Breaker Tuya chega sempre positivo.
  No `grid_meter`, `power_signed_w` usa o contador com timestamp mais recente: forward = importando (positivo),
  reverse = exportando (negativo). Se os timestamps forem iguais, o coletor nao grava sinal; o app so aceita uma
  leitura assinada da mesma amostra de `power_w` e, sem ela, recorre aos acumulados horarios.
- Rede (importado/exportado) = integracao da potencia assinada, NAO os contadores do Tuya (migration 20261020000100,
  aplicada em 2026-10-20). Os contadores total_forward_energy/reverse_energy_total do Tuya inflam a exportacao (~+30%) e o
  saldo: em 15/10 a 20/10 o Tuya somou 62,0 imp / 60,9 exp contra 55 / 46 da Neoenergia (saldo +1,1 contra +9); a potencia
  assinada integrada deu 53,7 / 47,0. v_grid_flow_* (lacunas de ate 60 min interpoladas) -> v_grid_energy_hourly/daily
  (potencia a partir da 1a hora cheia depois da 1a leitura assinada, 12/10 18:00; antes e em horas sem amostra, contadores)
  -> v_house_hourly/daily e v_credits. Geracao e aparelhos continuam nos contadores. v_grid_net_* (limite 10 min) fica so
  para a auditoria com os marcos da Neo. v_self_consumption_daily mantem o contador bruto do Tuya como fallback.
  Cada intervalo vai para a hora do FIM (como os deltas dos contadores). O cartao "Agora" continua com a defasagem
  Solarman x rede (cada serie mostra a ultima leitura, sem alinhar horario). Marcos da Neo (>= 3 dias entre eles) conferem o liquido.
- Desempenho (2026-10-21): v_energy_deltas recalculava a janela sobre toda a historia a cada consulta (0,4 a 4,9 s).
  Agora energy_hourly (kWh por serie e hora) e mantida por gatilho em readings (insert, backfill, delete e truncate;
  em erro o gatilho so avisa, a coleta nunca falha; rebuild_energy_hourly() refaz tudo) e v_energy_hourly/daily leem dela.
  v_now percorre as series pelo indice; primeiras leituras das views da casa sao min() pelo indice. get_home(dia) entrega
  o Inicio em uma chamada (usada pelo Inicio e pela Casa). Medido no banco: v_now 400 -> 0,5 ms, house_hourly 500 -> 32 ms,
  get_home ~65 ms. App: abre do cache (sw.js cache primeiro), guarda a ultima resposta do dia (localStorage) e atualiza em
  seguida; supabase-js e Manrope ficam em app/vendor e app/fonts (nada de CDN; o pdf.js do leitor de contas fica em app/vendor/pdfjs desde 1.3.1).
- Seguranca do app (1.3.1, 22/11/2026): CSP e cabecalhos em app/vercel.json (script-src 'self', connect-src so o
  Supabase do Energia). Nada de script inline no index.html nem CDN externo; ver app/tests/security.test.mjs.
- Interface: cor de dado = amarelo solar, ciano consumo, verde rede (seta indica o sentido), violeta ar, rosa boiler; botoes,
  abas e links usam branco-gelo (--ui). Nomes: "Da rede" / "Para a rede", "Injetando na rede" / "Puxando da rede". O cartao
  Agora mostra a idade de cada leitura e consumo "—" (com o motivo) quando as leituras nao fecham: ver agoraFlow em util.js.
  Casa: sem modo 2D; imagem diurna opcional (IMAGES em house-view.js).
- Assistente de energia (2026-11-23, M4 Capstone): agent/ (LangChain.js + Gemini + RAG hibrido no Weaviate), spec
  docs/superpowers/specs/2026-11-23-assistente-design.md, plano 4. So laboratorio local com dados simulados (agent/lab),
  nunca o Supabase de producao. Testes: `cd agent && npm ci && npm test && npm run eval:offline`. Chave do Gemini so em
  agent/.env. CI em .github/workflows/ci.yml (app, coletor, SQL, assistente). Comandos, subagentes e skills do projeto em .claude/.
- App PWA estatico em app/ (sem build). config.js vazio = modo demonstracao. Ver app/README.md.
- Publicado na Vercel (projeto de producao, fora desta copia publica), ligado ao GitHub desde 2026-10-09
  (Root Directory = app, ramo master): publicar = `git push origin master`. O `vercel deploy` de dentro de app/ NAO
  funciona mais (Root Directory), e nunca publicar a partir da raiz do repo (levaria os .env*).
  app/.vercelignore deixa de fora tests/, README e .env*.
- Contas de luz: migration 20261009000100_bills.sql (bills, v_bill_check) e leitura do PDF no aparelho (app/billparse.js).
  Testes do leitor: `node --test app/tests/billparse.test.mjs` (fixtures sem dados pessoais; PDFs nunca no repo).
  PDFs reais das contas ficam fora do repo.

## Regras
- Ao publicar mudanca no app, suba APP_VERSION e APP_DATE em app/version.js (aparece em Ajustes e nomeia o cache do service worker).
- Nunca colar segredos (Tuya Access ID/Secret, Solarman appId/appSecret, senhas) no chat ou no repo.
  Segredos so no cofre de secrets do Supabase / variaveis de ambiente do coletor.
- Coletor e somente leitura. Fuso dos dias: America/Sao_Paulo.
- Energia e Geely sao ambientes separados: nunca reutilizar project-ref, URL, chave, usuario, Vault secret, cron ou migration.
- Antes de `supabase db push`, confirmar que a CLI esta ligada ao project-ref do Energia.
- O Git reproduz o hardening de 22/11/2026, exceto o papel `claude_ro` (nao versionado). `supabase/refresh_now.sql` repete
  `request_collect()` da migration: mantenha os dois iguais.
- Responder em portugues do Brasil.

## Pendencias do Cesar
- Rodar `supabase migration repair --status reverted 20261113222555 20261113223129` (com a CLI ligada ao Energia).
- Decidir se o papel `claude_ro` ainda e usado (versionar ou remover).
- Habilitar protecao contra senhas vazadas no Supabase Auth.
- Testar em ambiente controlado a remocao de `pg_net` do schema `public`.
- Avaliar os indices das FKs `credit_baseline_bill_id_fkey` e `device_metric_map_device_id_fkey`.
- Observar `energy_hourly_hour_idx` antes de decidir remocao.
- Instalar/parear medidores e rodar Tuya API Explorer para os codigos de data points.
- Verificar o status do teste Tuya IoT Core, cujo lembrete anterior era estender ate 08/11/2026.
