// GERADO por scripts/assistente-exemplos.mjs a partir de agent/eval/results/gemini-2026-11-23.json. Não edite à mão.
// Respostas reais do assistente (agent/) na avaliação, sobre os dados de exemplo. O app só exibe.
export const EXEMPLOS = {
 "modelo": "gemini (gemini-3.8-flash)",
 "gerado_em": "2026-11-23T23:03:47.069Z",
 "hoje": "2026-11-20",
 "acertos": "10/10",
 "itens": [
  {
   "id": "consumo-media",
   "pergunta": "Por que ontem consumi mais que a média?",
   "resposta": "Ontem (19/11/2026), a casa consumiu 19,5 kWh, registrando 2,4 kWh a mais que a média dos últimos 7 dias (17,1 kWh). O principal responsável por esse aumento foi o boiler, que consumiu 6,5 kWh contra uma média de 3,6 kWh, totalizando 2,9 kWh adicionais. Em contrapartida, o ar-condicionado gastou 5,9 kWh, ficando 0,5 kWh abaixo da sua média de 6,5 kWh. A categoria outros aparelhos consumiu 7,0 kWh, exatamente igual à sua média recente. No total, a geração solar foi de 12,5 kWh, com 12,4 kWh importados da rede e 5,4 kWh exportados.",
   "fontes": "resumo_dia, comparar_periodo, buscar_documentos (v_house_daily/2026-11-19)",
   "cenario": "",
   "expert": "consumo",
   "motivo": "A pergunta trata sobre o consumo diário de energia e comparação com a média.",
   "passos": [
    {
     "ferramenta": "resumo_dia",
     "args": {
      "dia": "2026-11-19"
     },
     "ok": true
    },
    {
     "ferramenta": "comparar_periodo",
     "args": {
      "dia": "2026-11-19"
     },
     "ok": true
    },
    {
     "ferramenta": "buscar_documentos",
     "args": {
      "consulta": "2026-11-19 boiler",
      "colecao": "ResumoDiario"
     },
     "ok": true
    }
   ],
   "documentos": [
    {
     "titulo": "Dia 2026-11-19 (Qui)",
     "caminho": "v_house_daily/2026-11-19",
     "score": 1
    },
    {
     "titulo": "Dia 2026-11-01 (Dom)",
     "caminho": "v_house_daily/2026-11-01",
     "score": 0.652
    },
    {
     "titulo": "Dia 2026-11-05 (Qui)",
     "caminho": "v_house_daily/2026-11-05",
     "score": 0.645
    }
   ],
   "recuperacao": "memory",
   "conferidos": 14,
   "ms": 18179,
   "chamadas_llm": 4,
   "tokens": 4794,
   "ok": true
  },
  {
   "id": "consumo-dia",
   "pergunta": "Quanto a casa gerou e consumiu em 2026-11-15?",
   "resposta": "Em 15 de novembro de 2026, a casa gerou 12,2 kWh de energia solar e teve um consumo total de 15,9 kWh. Da rede elétrica, foram importados 10,2 kWh e injetados (exportados) 6,5 kWh, atingindo uma autossuficiência de 36%. Do consumo registrado, o ar-condicionado consumiu 6,8 kWh, o boiler gastou 2,3 kWh e as demais cargas (outros) somaram 6,8 kWh.",
   "fontes": "resumo_dia",
   "cenario": "",
   "expert": "consumo",
   "motivo": "A pergunta busca saber os dados de geração e consumo de energia em uma data específica.",
   "passos": [
    {
     "ferramenta": "resumo_dia",
     "args": {
      "dia": "2026-11-15"
     },
     "ok": true
    }
   ],
   "documentos": [],
   "recuperacao": "memory",
   "conferidos": 10,
   "ms": 11455,
   "chamadas_llm": 3,
   "tokens": 1754,
   "ok": true
  },
  {
   "id": "consumo-autossuficiencia",
   "pergunta": "Qual foi a autossuficiência de ontem?",
   "resposta": "A autossuficiência energética de ontem (19/11/2026) foi de 36%. Do consumo total de 19,5 kWh, 7,1 kWh vieram diretamente do autoconsumo da geração solar, enquanto 12,4 kWh foram importados da rede elétrica. A geração solar total do dia atingiu 12,5 kWh, dos quais 5,4 kWh foram exportados.",
   "fontes": "resumo_dia (v_house_daily)",
   "cenario": "",
   "expert": "consumo",
   "motivo": "A pergunta trata sobre autossuficiência energética de um dia específico.",
   "passos": [
    {
     "ferramenta": "resumo_dia",
     "args": {
      "dia": "2026-11-19"
     },
     "ok": true
    }
   ],
   "documentos": [],
   "recuperacao": "memory",
   "conferidos": 6,
   "ms": 7254,
   "chamadas_llm": 3,
   "tokens": 1731,
   "ok": true
  },
  {
   "id": "creditos-minimo",
   "pergunta": "Por que a conta de setembro veio com 100 kWh se eu injetei mais do que consumi?",
   "resposta": "Como o padrão de ligação da casa é trifásico, a distribuidora cobra um custo de disponibilidade obrigatório de 100 kWh mensais. Pela regra do setor elétrico, esse consumo mínimo faturado não pode ser abatido com créditos solares: compensa-se unicamente o volume consumido acima dele. Na fatura de setembro de 2026, a residência consumiu 312,0 kWh e injetou 312,0 kWh na rede. Dessa forma, foram compensados 212,0 kWh do consumo e faturados obrigatoriamente os 100,0 kWh do piso da ligação. A sobra de 100,0 kWh injetados virou crédito para os meses seguintes, elevando o saldo acumulado na conta para 2.038,7 kWh.",
   "fontes": "ferramentas creditos e buscar_documentos; agent/knowledge/regras-energia.md; app/tests/fixtures/conta-09-2026.json",
   "cenario": "",
   "expert": "creditos",
   "motivo": "Trata sobre cobrança na fatura, compensação de energia injetada e taxa mínima de faturamento.",
   "passos": [
    {
     "ferramenta": "creditos",
     "args": {},
     "ok": true
    },
    {
     "ferramenta": "buscar_documentos",
     "args": {
      "consulta": "custo de disponibilidade 100 kWh trifasico compensacao creditos",
      "colecao": "RegrasEnergia"
     },
     "ok": true
    },
    {
     "ferramenta": "buscar_documentos",
     "args": {
      "colecao": "Contas",
      "consulta": "setembro 100 kWh fatura consumo injetado compensado"
     },
     "ok": true
    }
   ],
   "documentos": [
    {
     "titulo": "Regras de energia usadas pelo assistente > 1. Sistema de compensação de energia (SCEE) > Validade dos créditos",
     "caminho": "agent/knowledge/regras-energia.md",
     "score": 0.53
    },
    {
     "titulo": "Conta 2026-05",
     "caminho": "app/tests/fixtures/conta-05-2026.json",
     "score": 0.833
    },
    {
     "titulo": "Conta 2026-07",
     "caminho": "app/tests/fixtures/conta-07-2026.json",
     "score": 0.665
    }
   ],
   "recuperacao": "memory",
   "conferidos": 10,
   "ms": 22208,
   "chamadas_llm": 3,
   "tokens": 5014,
   "ok": true
  },
  {
   "id": "creditos-maio",
   "pergunta": "Quanto foi compensado na conta de maio de 2026?",
   "resposta": "Na conta de maio de 2026, foram compensados 306 kWh. O consumo da rede no mês foi de 406 kWh, dos quais 100 kWh correspondem ao mínimo faturado da ligação trifásica, que não sai dos créditos. Para cobrir o excedente compensado de 306 kWh, foram utilizados 251 kWh injetados na rede no próprio mês e 55 kWh do saldo de créditos anteriores.",
   "fontes": "creditos, buscar_documentos (agent/knowledge/regras-energia.md)",
   "cenario": "",
   "expert": "creditos",
   "motivo": "Trata da compensação de energia e detalhes da conta de luz.",
   "passos": [
    {
     "ferramenta": "creditos",
     "args": {},
     "ok": true
    },
    {
     "ferramenta": "buscar_documentos",
     "args": {
      "consulta": "maio 2026 compensado faturado",
      "colecao": "Contas"
     },
     "ok": true
    },
    {
     "ferramenta": "buscar_documentos",
     "args": {
      "colecao": "RegrasEnergia",
      "consulta": "compensação mínimo faturado trifásico créditos"
     },
     "ok": true
    }
   ],
   "documentos": [
    {
     "titulo": "Conta 2026-08",
     "caminho": "app/tests/fixtures/conta-08-2026.json",
     "score": 0.839
    },
    {
     "titulo": "Conta 2026-09",
     "caminho": "app/tests/fixtures/conta-09-2026.json",
     "score": 0.78
    },
    {
     "titulo": "Conta 2026-07",
     "caminho": "app/tests/fixtures/conta-07-2026.json",
     "score": 0.71
    }
   ],
   "recuperacao": "memory",
   "conferidos": 7,
   "ms": 17972,
   "chamadas_llm": 5,
   "tokens": 10013,
   "ok": true
  },
  {
   "id": "creditos-conferencia",
   "pergunta": "O saldo de créditos da conta de setembro bate com o de agosto?",
   "resposta": "Sim, o saldo de créditos da conta de setembro de 2026 bate perfeitamente com o de agosto de 2026. A fatura de agosto encerrou com saldo de 1938,7 kWh. No mês de setembro, foram injetados 312,0 kWh e compensados 212,0 kWh — pois o mínimo faturado de 100,0 kWh não é compensado —, gerando um acréscimo de 100,0 kWh. Dessa forma, o saldo registrado na conta de setembro fechou exatamente em 2038,7 kWh, apresentando diferença de 0,0 kWh na conferência oficial.",
   "fontes": "creditos, buscar_documentos (app/tests/fixtures/conta-08-2026.json, app/tests/fixtures/conta-09-2026.json)",
   "cenario": "",
   "expert": "creditos",
   "motivo": "A pergunta trata sobre saldo de créditos de energia e faturas mensais.",
   "passos": [
    {
     "ferramenta": "creditos",
     "args": {},
     "ok": true
    },
    {
     "ferramenta": "buscar_documentos",
     "args": {
      "consulta": "saldo de creditos agosto setembro",
      "colecao": "Contas"
     },
     "ok": true
    },
    {
     "ferramenta": "buscar_documentos",
     "args": {
      "colecao": "Contas",
      "consulta": "Conta 2026-08 agosto"
     },
     "ok": true
    }
   ],
   "documentos": [
    {
     "titulo": "Conta 2026-05",
     "caminho": "app/tests/fixtures/conta-05-2026.json",
     "score": 0.272
    },
    {
     "titulo": "Conta 2026-09",
     "caminho": "app/tests/fixtures/conta-09-2026.json",
     "score": 0.69
    },
    {
     "titulo": "Conta 2026-06",
     "caminho": "app/tests/fixtures/conta-06-2026.json",
     "score": 0.209
    }
   ],
   "recuperacao": "memory",
   "conferidos": 13,
   "ms": 17857,
   "chamadas_llm": 4,
   "tokens": 9946,
   "ok": true
  },
  {
   "id": "creditos-duracao",
   "pergunta": "Quanto tempo meu saldo de créditos ainda dura?",
   "resposta": "Seu saldo atual acumulado é de 2084,3 kWh. Com base no consumo líquido médio recente de 1,7 kWh por dia, a estimativa é de que esse saldo dure aproximadamente 1.240 dias (cerca de 3 anos e 5 meses). Vale lembrar que, pelas regras do Sistema de Compensação de Energia Elétrica (SCEE), os créditos têm validade de 60 meses antes de expirarem.",
   "fontes": "creditos e agent/knowledge/regras-energia.md (RegrasEnergia)",
   "cenario": "",
   "expert": "creditos",
   "motivo": "A pergunta trata especificamente da estimativa de duração do saldo de créditos de energia.",
   "passos": [
    {
     "ferramenta": "creditos",
     "args": {},
     "ok": true
    },
    {
     "ferramenta": "buscar_documentos",
     "args": {
      "consulta": "validade dos créditos de energia expiração meses",
      "colecao": "RegrasEnergia"
     },
     "ok": true
    }
   ],
   "documentos": [
    {
     "titulo": "Regras de energia usadas pelo assistente > 1. Sistema de compensação de energia (SCEE) > O que é",
     "caminho": "agent/knowledge/regras-energia.md",
     "score": 0.272
    }
   ],
   "recuperacao": "memory",
   "conferidos": 6,
   "ms": 14923,
   "chamadas_llm": 4,
   "tokens": 4354,
   "ok": true
  },
  {
   "id": "operacao-tuya-atrasada",
   "pergunta": "A coleta da Tuya está funcionando?",
   "resposta": "A coleta da Tuya não está funcionando como esperado: seu diagnóstico atual é \"atrasada\", com a última rodada registrada há 120 minutos. Em contrapartida, a coleta da Solarman está \"em dia\", tendo sua última rodada ocorrida há 2 minutos. Como a Tuya deve coletar dados a cada 5 minutos ao longo de 24 horas, qualquer intervalo superior a 12 minutos caracteriza atraso. Segundo as especificações do projeto, as causas prováveis para falhas ou atrasos na Tuya envolvem instabilidade na API/rede, token expirado ou assinatura de teste da plataforma Tuya vencida. Quando isso ocorre, o incidente é registrado na tabela `collector_runs`, mantendo a consistência dos dados acumulados assim que o serviço for restabelecido.",
   "fontes": "status_coleta, buscar_documentos (docs/superpowers/specs/2026-10-08-energia-casa-design.md)",
   "cenario": "Cenário simulado: Solarman com última coleta há 2 min, Tuya com última coleta há 120 min.",
   "expert": "operacao",
   "motivo": "Pergunta sobre o funcionamento da coleta de dados da Tuya.",
   "passos": [
    {
     "ferramenta": "status_coleta",
     "args": {},
     "ok": true
    },
    {
     "ferramenta": "buscar_documentos",
     "args": {
      "consulta": "coleta tuya atrasada falha causa",
      "colecao": "ProjetoDocs"
     },
     "ok": true
    }
   ],
   "documentos": [
    {
     "titulo": "Energia Casa — design (spec) > 9. Falhas e casos limite",
     "caminho": "docs/superpowers/specs/2026-10-08-energia-casa-design.md",
     "score": 0.77
    },
    {
     "titulo": "Assistente de energia (LangChain.js + Gemini + RAG no Weaviate) > Avaliação",
     "caminho": "agent/README.md",
     "score": 0.781
    }
   ],
   "recuperacao": "memory",
   "conferidos": 5,
   "ms": 19506,
   "chamadas_llm": 4,
   "tokens": 3857,
   "ok": true
  },
  {
   "id": "operacao-solarman-noite",
   "pergunta": "A Solarman está sem dados novos há horas, a coleta falhou?",
   "resposta": "Não, a coleta da Solarman não falhou. A fonte Solarman está com diagnóstico de pausa noturna e idade de 185 minutos desde a última rodada, pois opera apenas entre 06:30 e 18:55 no horário de Brasília. Já a fonte Tuya funciona 24 horas, apresenta diagnóstico em dia e idade de 2 minutos na última rodada. Portanto, a ausência de novos dados da Solarman no período noturno é o comportamento normal esperado.",
   "fontes": "status_coleta",
   "cenario": "Cenário simulado às 22:00 (Brasília): Solarman com última coleta há 185 min, Tuya com última coleta há 2 min.",
   "expert": "operacao",
   "motivo": "Trata-se de dúvida sobre atraso e falha na coleta de dados pela plataforma Solarman.",
   "passos": [
    {
     "ferramenta": "status_coleta",
     "args": {},
     "ok": true
    }
   ],
   "documentos": [],
   "recuperacao": "memory",
   "conferidos": 3,
   "ms": 11785,
   "chamadas_llm": 3,
   "tokens": 1398,
   "ok": true
  },
  {
   "id": "rag-contadores-tuya",
   "pergunta": "Por que o sistema não usa os contadores de energia da Tuya para calcular o que vai e vem da rede?",
   "resposta": "O sistema não utiliza os contadores de energia da Tuya porque eles inflam a exportação para a rede em cerca de 30%. Entre 15/10 e 20/10/2026, os contadores registraram 62,0 kWh importados e 60,9 kWh exportados, enquanto a fatura da Neoenergia apontou 55 e 46 kWh, e o cálculo por integração da potência assinada resultou em 53,7 kWh e 47,0 kWh. Por esse motivo, a medição é feita integrando a potência assinada (`power_signed_w`). Operacionalmente, a fonte Solarman está com diagnóstico \"em dia\" (idade de 2 minutos) e a fonte Tuya também está com diagnóstico \"em dia\" (idade de 2 minutos).",
   "fontes": "status_coleta, buscar_documentos (agent/knowledge/regras-energia.md)",
   "cenario": "",
   "expert": "operacao",
   "motivo": "Trata do funcionamento técnico e da utilização dos medidores de energia Tuya na coleta de dados.",
   "passos": [
    {
     "ferramenta": "buscar_documentos",
     "args": {
      "consulta": "contadores energia Tuya rede importação exportação"
     },
     "ok": true
    },
    {
     "ferramenta": "status_coleta",
     "args": {},
     "ok": true
    }
   ],
   "documentos": [
    {
     "titulo": "Regras de energia usadas pelo assistente > 4. Como o sistema mede a energia > Fontes",
     "caminho": "agent/knowledge/regras-energia.md",
     "score": 0.553
    },
    {
     "titulo": "Energia Casa — design (spec) > 4. Fontes de dados > 4.2 Tuya Cloud API",
     "caminho": "docs/superpowers/specs/2026-10-08-energia-casa-design.md",
     "score": 0.71
    }
   ],
   "recuperacao": "memory",
   "conferidos": 9,
   "ms": 18460,
   "chamadas_llm": 3,
   "tokens": 2547,
   "ok": true
  }
 ]
};
