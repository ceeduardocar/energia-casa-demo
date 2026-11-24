// Métricas dos registros do assistente (JSONL de agent/logs/ ou os registros de um resultado da avaliação).
import type { Registro } from "./log.ts";

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const count = <T,>(xs: T[], key: (x: T) => string) =>
  xs.reduce<Record<string, number>>((acc, x) => ((acc[key(x)] = (acc[key(x)] ?? 0) + 1), acc), {});

export function summarize(rows: Registro[]) {
  const passos = rows.flatMap(r => r.passos);
  const recuperados = rows.flatMap(r => r.recuperados);
  const ms = rows.map(r => r.ms_total);
  return {
    perguntas: rows.length,
    periodo: rows.length ? { de: rows.map(r => r.inicio).sort()[0], ate: rows.map(r => r.inicio).sort().at(-1) } : null,
    por_expert: count(rows, r => r.rota.expert || "(nenhum)"),
    roteamento_por_reserva: rows.filter(r => r.rota.reserva).length,
    latencia_ms: { media: Math.round(avg(ms)), p50: pct(ms, 50), p95: pct(ms, 95), max: Math.max(0, ...ms) },
    tokens: {
      entrada: rows.reduce((a, r) => a + r.tokens.entrada, 0),
      saida: rows.reduce((a, r) => a + r.tokens.saida, 0),
      media_por_pergunta: Math.round(avg(rows.map(r => r.tokens.entrada + r.tokens.saida))),
      chamadas_llm: rows.reduce((a, r) => a + r.tokens.chamadas_llm, 0),
    },
    ferramentas: {
      chamadas: passos.length,
      por_ferramenta: count(passos, p => p.ferramenta),
      com_erro: passos.filter(p => !p.ok).length,
      ms_medio: Math.round(avg(passos.map(p => p.ms))),
    },
    rag: {
      buscas: new Set(rows.flatMap(r => r.recuperados.map(h => r.id + h.consulta))).size,
      trechos: recuperados.length,
      por_colecao: count(recuperados, h => h.colecao),
      documentos_mais_citados: Object.entries(count(recuperados, h => h.caminho)).sort((a, b) => b[1] - a[1]).slice(0, 5),
    },
    numeros: {
      verificados: rows.reduce((a, r) => a + r.checagem.verificados, 0),
      perguntas_com_numero_sem_fonte: rows.filter(r => !r.checagem.ok).length,
      sem_fonte: rows.filter(r => !r.checagem.ok).map(r => ({ id: r.id, pergunta: r.pergunta, numeros: r.checagem.sem_fonte })),
    },
    erros: rows.filter(r => r.erro).map(r => ({ id: r.id, pergunta: r.pergunta, erro: r.erro })),
  };
}

export type Summary = ReturnType<typeof summarize>;

export function toMarkdown(s: Summary): string {
  const kv = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(" · ") || "—";
  return [
    `# Relatório do assistente`,
    ``,
    `| Métrica | Valor |`,
    `|---|---|`,
    `| Perguntas | ${s.perguntas}${s.periodo ? ` (${s.periodo.de} a ${s.periodo.ate})` : ""} |`,
    `| Por expert | ${kv(s.por_expert)} |`,
    `| Roteadas pela reserva de palavras-chave | ${s.roteamento_por_reserva} |`,
    `| Latência (média · p50 · p95 · máx.) | ${s.latencia_ms.media} · ${s.latencia_ms.p50} · ${s.latencia_ms.p95} · ${s.latencia_ms.max} ms |`,
    `| Tokens (entrada · saída · média por pergunta) | ${s.tokens.entrada} · ${s.tokens.saida} · ${s.tokens.media_por_pergunta} |`,
    `| Chamadas ao LLM | ${s.tokens.chamadas_llm} |`,
    `| Ferramentas chamadas | ${s.ferramentas.chamadas} (${kv(s.ferramentas.por_ferramenta)}) |`,
    `| Ferramentas com erro | ${s.ferramentas.com_erro} |`,
    `| Buscas no RAG · trechos | ${s.rag.buscas} · ${s.rag.trechos} (${kv(s.rag.por_colecao)}) |`,
    `| Números verificados na resposta | ${s.numeros.verificados} |`,
    `| Perguntas com número sem fonte | ${s.numeros.perguntas_com_numero_sem_fonte} |`,
    `| Perguntas com erro | ${s.erros.length} |`,
    ``,
    s.rag.documentos_mais_citados.length ? `Documentos mais recuperados: ${s.rag.documentos_mais_citados.map(([c, n]) => `\`${c}\` (${n})`).join(", ")}.` : "",
    s.numeros.sem_fonte.length ? `\nNúmeros sem fonte:\n${s.numeros.sem_fonte.map(x => `- "${x.pergunta}": ${x.numeros.join(", ")}`).join("\n")}` : "",
    s.erros.length ? `\nErros:\n${s.erros.map(x => `- "${x.pergunta}": ${x.erro}`).join("\n")}` : "",
  ].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// Aceita JSONL (um registro por linha) ou o JSON de um resultado da avaliação (campo "registros").
export function parseRecords(text: string): Registro[] {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith("{") && !t.includes("\n{")) {
    const j = JSON.parse(t);
    if (Array.isArray(j.registros)) return j.registros;
    return [j];
  }
  return t.split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
}
