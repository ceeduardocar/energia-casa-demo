# EnergyKontrol - PWA

Sua energia sob controle.

App estatico (sem build): HTML + JS modular + CSS. Le as views do banco (Plano 1) pelo Supabase.

## Ver agora (modo demonstracao)
    cd app && python3 -m http.server 8080     # ou: npx serve .
Abra http://localhost:8080 . Com `config.js` vazio o app mostra dados de exemplo.

## Tela Casa
A aba `Casa` (`#/casa`) mostra a ilustração da casa com pontos por cima (geração, consumo, rede, ar-condicionado,
boiler, piscina e carro). A ilustração tem proporção fixa, então os pontos ficam no lugar em qualquer largura; no celular
os valores vão numa lista logo abaixo, em tela larga viram etiquetas sobre a imagem. As linhas animadas seguem a potência
(mais grossas com mais potência) e invertem o sentido quando a casa puxa da rede.
A imagem é `assets/casa-noite.webp` (184 KB). Para usar uma versão diurna, coloque o arquivo em `assets/` e troque
`day: null` em `IMAGES`, no `house-view.js`: dia (6h às 18h) usa a diurna, o resto usa a noturna. Não existe mais o modo 2D.

## Desempenho
- O Início e a Casa vêm de uma única chamada ao banco (função `get_home`).
- A última resposta do dia fica guardada no aparelho: a tela abre na hora com ela ("Atualizando...") e troca pelos dados novos.
- O service worker abre o app do cache. `vendor/supabase.umd.js` (supabase-js 2.45.4) e `fonts/manrope-latin-wght.woff2`
  (Manrope variável, subconjunto latino) ficam no próprio app: nenhuma CDN é necessária para abrir.

## Ligar ao banco
1. Supabase > Project Settings > API: copie a **Project URL** e a chave **anon** (publica).
2. Cole em `config.js`. NUNCA use a service_role aqui.
3. Crie seu usuario em Authentication > Users (e-mail e senha) e mantenha o cadastro publico desativado.
4. Registre o `auth.users.id` desse usuario em `private.energy_users`; estar apenas autenticado nao concede acesso operacional.
5. Abra o app: pede e-mail e senha uma vez; a sessao fica salva no celular.

## Publicar (para abrir no celular)
Qualquer hospedagem estatica com HTTPS serve (Vercel, Netlify, GitHub Pages, Cloudflare Pages): publique a pasta `app/`.
No celular: abrir o endereco > menu do navegador > "Adicionar a tela inicial".

## Contrato com o banco
Usados: get_home (Início e Casa), v_house_hourly, v_house_daily, v_credits, v_boiler_off_sun, v_collector_status,
v_self_consumption_daily, v_grid_audit_report e a RPC request_collect.
Tabela escrita pelo app: credit_baseline (saldo da conta de luz). Nada mais.
A RPC `request_collect()` nao grava dados de negocio pelo navegador: ela valida o usuario, aplica limite de 30 s e aciona
um fluxo interno de coleta.
`grid_meter.power_w` chega como modulo. O coletor grava `power_signed_w` usando o contador Tuya atualizado
mais recentemente (forward = importando; reverse = exportando). O app so usa o sinal quando as duas metricas
sao da mesma amostra; caso contrario, recorre ao saldo da ultima hora de `v_house_hourly`.
Fuso dos dias: America/Sao_Paulo (as views ja entregam dia/hora locais).

## Segurança do acesso operacional

- `v_collector_status` usa `security_invoker=true` e respeita as politicas do usuario chamador.
- A leitura de `collector_runs` pelo frontend fica limitada a `source`, `ok` e `started_at`.
- `error_message` e detalhes internos do coletor nao sao concedidos ao papel `authenticated`.
- Somente usuarios presentes em `private.energy_users` veem o status e solicitam atualizacao manual.
- Usuario autenticado fora da lista ve 0 linhas e recebe SQLSTATE `42501` ao chamar `request_collect()`.
- `PUBLIC` e `anon` nao executam `request_collect()` nem `rls_auto_enable()`.
- O frontend usa chave publica; nunca colocar `service_role`, segredos Tuya ou Solarman em `config.js`.

Cabecalhos de seguranca (CSP sem script inline nem dominio externo, nosniff, Referrer-Policy, Permissions-Policy) em
`vercel.json`. Script novo vai em arquivo proprio, nunca inline no `index.html`. Se o projeto Supabase mudar, ajustar
`connect-src` na CSP. `tests/security.test.mjs` confere essas regras.

Auditoria e testes de 22/11/2026: `../docs/2026-11-22-isolamento-seguranca-supabase.md`.

## Contas de luz
Rotas: #/contas (lista e envio), #/conta (conferir), #/relatorio (medidor x Neoenergia).
- Banco: tabela `bills`, view `v_bill_check` e permissoes na migration `supabase/migrations/20261009000100_bills.sql`
  (authenticated le e insere; nao altera nem apaga). O app NAO envia file_name (so existe na tela).
- Leitura do PDF: `billparse.js`, no proprio aparelho, com pdf.js 4.10.38 em `vendor/pdfjs` (sem CDN, sem eval). O arquivo nao sai do celular e
  nao e guardado. PDF com senha: o app pergunta a senha na hora e nao guarda. Foto ou PDF de outro layout: abre a
  conferencia com os campos vazios para digitar.
- Campos fora do quadro principal: `other_brl` soma os demais itens da fatura (ex.: credito ITAIPU, negativo), para a
  verificacao "soma = total" fechar. O total vem da linha TOTAL dos itens (a 2a via paga imprime "TOTAL A PAGAR 0,00").
- Ao confirmar, o app grava `bills` e o saldo em `credit_baseline` (as_of = data da leitura atual, source = bill).

## Créditos no mês
A tela Créditos (`#/creditos`) abre com o bloco "Créditos no mês", calculado nas contas gravadas em `bills` (sem tabela nova):
- compensado = consumo − 100 kWh do mínimo faturado; do próprio mês = o que sobra da injeção; do saldo antigo = o resto.
- saldo do mês = injetado − compensado (positivo: sobrou; negativo: usou saldo).
- conferência: saldo de um mês = saldo do mês anterior + saldo do mês, quando as duas contas são de meses seguidos.
Regras em `credits-months.js` (funções puras) e apresentação em `credits-html.js`. Lotes com validade não estão no banco:
o relatório da Neoenergia traz esse detalhe, mas o app ainda não o lê.

## Testes do app
    node --test app/tests/billparse.test.mjs
Fixtures em `app/tests/fixtures/`: texto de 5 contas reais (05 a 09/2026) sem nome, CPF, endereco, unidade consumidora,
codigos do cliente e linha digitavel do boleto,
com a chave de acesso trocada por digitos ficticios. Nunca commitar os PDFs.
