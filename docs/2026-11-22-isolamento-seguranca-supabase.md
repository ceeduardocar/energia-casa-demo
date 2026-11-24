# Auditoria de isolamento e segurança do Supabase

**Projeto:** EnergyKontrol / energia-casa  
**Data da intervenção:** 22/11/2026  
**Ambiente validado:** produção  
**Supabase Energia:** `<PROJECT_REF>` (`us-west-2`)  
**Supabase Geely:** `bhjdloxzrslsawbppvmb` (`us-east-2`)

## 1. Objetivo

Validar a separação entre os projetos Energia Casa e Meu Geely, remover artefatos de veículo encontrados indevidamente no banco de energia e reforçar os controles de acesso usados pelo PWA para consultar o estado dos coletores e solicitar atualização manual.

Os dois projetos devem permanecer isolados em todos os aspectos: banco, autenticação, funções, automações, segredos, variáveis de ambiente e implantação.

## 2. Limpeza de artefatos do Geely no Energia Casa

A inspeção do projeto Energia identificou objetos de domínio veicular que não pertenciam ao EnergyKontrol. Antes da remoção foi confirmado que as tabelas estavam vazias e que os objetos não eram dependências da coleta de energia.

Foram removidos do projeto Energia:

- 9 tabelas vazias relacionadas ao domínio veicular;
- 3 funções auxiliares privadas relacionadas ao domínio veicular;
- 1 gatilho associado a esses objetos.

Não houve alteração no projeto Supabase do Meu Geely.

### Validação posterior à limpeza

| Verificação | Resultado executado |
| --- | --- |
| Tabelas com nome `vehicle%` no Energia | 0 |
| Funções com nome relacionado a veículo no Energia | 0 |
| Gatilhos relacionados a veículo no Energia | 0 |
| Coletor Solarman | operacional |
| Coletor Tuya | operacional |
| Projeto Meu Geely | não alterado |

## 3. Reforço de autorização

### 3.1 Cadastro privado de usuários permitidos

Foi criado o cadastro `private.energy_users`, vinculado a `auth.users`, para representar explicitamente quem pode acessar as informações operacionais do EnergyKontrol.

Controles aplicados:

- RLS habilitado como defesa em profundidade;
- política de leitura limitada ao próprio `auth.uid()`;
- privilégios removidos de `PUBLIC` e `anon`;
- `authenticated` recebe apenas o acesso mínimo necessário para a verificação;
- produção validada com exatamente 1 usuário autorizado.

### 3.2 Estado dos coletores

A tabela `public.collector_runs` passou a permitir leitura pelo frontend somente quando o usuário autenticado consta em `private.energy_users`.

O papel `authenticated` recebeu leitura apenas das colunas necessárias à interface:

- `source`;
- `ok`;
- `started_at`.

A coluna `error_message` e os demais detalhes internos não foram expostos ao frontend.

A view `public.v_collector_status` foi alterada para `security_invoker = true`. Com isso, a consulta passa a respeitar os privilégios e as políticas RLS do usuário chamador, em vez de usar implicitamente os privilégios do proprietário da view.

### 3.3 Atualização manual

A função `public.request_collect()` permanece como `SECURITY DEFINER` porque precisa acionar o fluxo privilegiado de coleta. Foram adicionados controles compensatórios:

- `search_path` vazio e referências qualificadas;
- validação de `auth.uid()` contra `private.energy_users` antes da operação;
- erro explícito `42501 — não autorizado` para usuários fora da lista;
- limite de uma solicitação a cada 30 segundos;
- `EXECUTE` removido de `PUBLIC` e `anon`;
- `EXECUTE` concedido somente a `authenticated`.

### 3.4 Função administrativa de RLS

O privilégio de execução de `public.rls_auto_enable()` foi removido de `PUBLIC`, `anon` e `authenticated`. A função continua disponível somente ao fluxo administrativo/event trigger que necessita dela.

## 4. Testes executados em produção

Os itens abaixo são resultados efetivamente executados em 22/11/2026, e não exemplos simulados.

| Caso | Resultado esperado | Resultado obtido | Situação |
| --- | --- | --- | --- |
| Usuário autorizado abre o painel | Sessão aceita e dados retornados | sessão autenticada; `get_home()` retornou objeto | passou |
| Usuário autorizado consulta o status | Visualizar apenas o status operacional | 2 linhas visíveis | passou |
| Usuário autorizado solicita atualização | Coleta iniciada ou limitada pela janela de 30 s | resposta recebida; primeira chamada iniciada | passou |
| Usuário autenticado não cadastrado consulta status | Nenhum dado visível | 0 linhas | passou |
| Usuário autenticado não cadastrado solicita atualização | Operação bloqueada | SQLSTATE `42501`, mensagem `não autorizado` | passou |
| Papel `anon` executa atualização | Privilégio inexistente | `EXECUTE = false` | passou |
| Frontend tenta ler `error_message` | Privilégio inexistente | leitura da coluna não concedida | passou |
| Coleta após o reforço | Solarman e Tuya continuam funcionando | últimas execuções das duas fontes com `ok = true` | passou |
| Diagnóstico de saúde | Nenhum alerta de saúde | 0 alertas | passou |

As coletas de validação mais recentes foram registradas aproximadamente às 16:03 no horário de Brasília, com sucesso para Solarman e Tuya.

## 5. Alertas resolvidos

A nova execução dos advisors confirmou a remoção dos alertas relacionados a:

- view `v_collector_status` operando como security definer;
- execução de `rls_auto_enable()` por usuários autenticados ou anônimos.

## 6. Riscos e alertas remanescentes

| Item | Nível | Decisão atual | Próxima ação |
| --- | --- | --- | --- |
| `api_tokens` com RLS e sem policy | informativo | tabela permanece fechada ao frontend e usada apenas pelo backend | manter sem policy enquanto o acesso continuar exclusivamente privilegiado |
| extensão `pg_net` no schema `public` | alerta | não movida para evitar impacto no cron e na coleta | testar a mudança em ambiente controlado antes de alterar produção |
| `request_collect()` como `SECURITY DEFINER` | alerta | uso intencional, mitigado por allowlist, `auth.uid()`, privilégios mínimos e rate limit | avaliar futura função intermediária em schema não exposto |
| proteção contra senhas vazadas desabilitada | alerta | pendente | habilitar no painel do Supabase Auth e retestar login |
| FK `credit_baseline_bill_id_fkey` sem índice | informativo | pendente | medir e criar índice se houver ganho |
| FK `device_metric_map_device_id_fkey` sem índice | informativo | pendente | medir e criar índice se houver ganho |
| índice `energy_hourly_hour_idx` sem uso registrado | informativo | mantido | observar carga real antes de decidir remoção |

## 7. Regras de isolamento Energia × Geely

1. O frontend de Energia deve usar somente a URL e a chave pública do projeto Energia.
2. O frontend do Geely deve usar somente a URL e a chave pública do projeto Geely.
3. Chaves `service_role`, senhas, tokens Solarman e segredos Tuya nunca entram no frontend, no Git ou na documentação.
4. Edge Functions, cron jobs, Vault secrets e variáveis de ambiente devem ser criados no projeto correspondente.
5. Nenhuma migration de veículo deve ser executada no projeto Energia.
6. Nenhuma migration de energia deve ser executada no projeto Geely.
7. Antes de aplicar migrations, confirmar o `project-ref` ligado pela CLI.
8. Após alterações em views, funções, RLS ou grants, executar novamente os advisors e os testes de autorização.

## 8. Estado do versionamento

A limpeza e o reforço de segurança foram aplicados diretamente no banco de produção e depois versionados:

- `20261122192350_restrict_energy_access_to_authorized_users.sql`: cadastro `private.energy_users`, `private.is_energy_user()`, políticas RLS, revoke de TRUNCATE, `security_invoker` nas views e `request_collect()`. Consta no histórico de produção com texto idêntico ao do repositório.
- `20261122200000_reconcile_hardening_grants.sql`: o que tinha ficado só em produção (RLS e política `energy_users_self_read` em `private.energy_users`, leitura de `collector_runs` limitada a `source`, `ok` e `started_at`, revoke de `rls_auto_enable()`). Idempotente: em produção não muda nada.

A comparação com produção foi feita em 22/11/2026 por consultas somente de leitura. Sem a segunda migration, um banco recriado a partir do Git negava ao usuário autorizado a leitura de `v_collector_status` e, por consequência, o `get_home()`. A suíte local passou a simular `auth.users` e `auth.uid()` e cobre os casos da seção 4.

Ainda fora do Git:

1. o histórico de migrations do Energia registra duas migrations do Geely (`20261113222555 create_meu_geely_shared_core` e `20261113223129 bootstrap_vehicle_owner_and_capabilities`), cujos objetos já foram removidos. Corrigir com `supabase migration repair --status reverted 20261113222555 20261113223129`, com a CLI ligada ao project-ref do Energia;
2. o papel `claude_ro` (login, sem bypass de RLS) e suas políticas `ro_read` em `readings`, `devices`, `device_metric_map`, `collector_runs` e `settings`. Decidir se continua em uso; se sim, versionar, se não, remover.

### Atualização posterior (22/11/2026, noite)

A migration `supabase/migrations/20261122192350_restrict_energy_access_to_authorized_users.sql` foi versionada
(commit `304439a`) e consta em `supabase_migrations.schema_migrations` do Energia. Falta conferir se o conteúdo
dela cobre tudo o que foi aplicado manualmente antes de considerar o Git uma reprodução completa.

## 8.1 Revisão complementar de segurança (22/11/2026)

Releitura dos advisors às 16:42 de Brasília: os 4 itens da seção 6 continuam (senhas vazadas, `request_collect()`,
`pg_net` em `public`, `api_tokens` sem policy). Conferido no catálogo: `api_tokens` só tem grants para `postgres` e
`service_role`; as tabelas do schema `net` só para `supabase_admin`.

| Item | Risco | Situação |
| --- | --- | --- |
| Histórico de migrations do Energia registra `20261113222555 create_meu_geely_shared_core` e `20261113223129 bootstrap_vehicle_owner_and_capabilities`, que não existem no repositório | operacional: o próximo `db push` acusa migrations remotas desconhecidas; contraria a regra 5 da seção 7 | pendente: depois de confirmar que nada delas restou, `supabase migration repair --status reverted 20261113222555 20261113223129` com a CLI ligada ao Energia |
| pdf.js carregado do jsDelivr sem verificação de integridade, no código que recebe o PDF da conta (CPF) e a senha do PDF | médio (cadeia de suprimentos) | corrigido no app 1.3.1: pdf.js 4.10.38 em `app/vendor/pdfjs`, `isEvalSupported: false` |
| App sem Content-Security-Policy | baixo (não há XSS conhecido; os campos do PDF passam por `esc()`) | corrigido no app 1.3.1: `app/vercel.json` com CSP (`script-src 'self'`, `connect-src` só o Supabase do Energia, `object-src`/`frame-ancestors 'none'`), `nosniff`, `Referrer-Policy`, `Permissions-Policy`; o script inline de preconnect virou `preconnect.js` |
| Edge Function `collect` | nenhum achado relevante: só POST, segredo conferido no Vault por função restrita ao `service_role`, 401 sem detalhes | sem ação |

Testes do app 1.3.1: `node --test app/tests/*.test.mjs` (53 passando, inclui `security.test.mjs`) e navegador
headless servindo o app com os cabeçalhos de `vercel.json`, em modo demonstração e com o projeto real: telas abrem,
pdf.js local lê um PDF de teste e nenhuma violação de CSP no console.

## 9. Conclusão

O banco do EnergyKontrol não possui mais objetos de domínio veicular detectáveis por nome, e o projeto Meu Geely não foi alterado. O acesso ao estado dos coletores e à atualização manual deixou de depender apenas do papel `authenticated` e passou a exigir autorização explícita do usuário.

O sistema permaneceu operacional após a intervenção. Os alertas remanescentes estão documentados como riscos aceitos ou pendências controladas; portanto, não devem ser apresentados como corrigidos até que sejam tratados e retestados.