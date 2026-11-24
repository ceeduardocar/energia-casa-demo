// Tela "Assistente": mostra respostas GRAVADAS do assistente de energia (agent/: LangChain.js + Gemini + RAG),
// tiradas da rodada da avaliação em agent/eval/results. Nada aqui chama LLM, banco ou outro site:
// a demo pública não tem chave do Gemini nem dados reais. Perguntas livres só no laboratório local (npm run ask).
import { EXEMPLOS } from "./assistente-exemplos.js";
import { esc } from "./util.js";

const EXPERT = { consumo: "Consumo", creditos: "Créditos", operacao: "Operação" };
const FERRAMENTA = {
  resumo_dia: "números do dia (v_house_daily)",
  comparar_periodo: "compara o dia com a média de 7 dias",
  creditos: "contas de luz e saldo de créditos",
  status_coleta: "status dos coletores",
  buscar_documentos: "busca no RAG (vetorial + palavras-chave)",
};
const dataBr = (iso) => iso.slice(0, 10).split("-").reverse().join("/");
const num = (v, d = 0) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
// Texto do modelo: escapa tudo e só então troca `código` por <code>. Parágrafos por linha em branco.
export const paragrafos = (t) => String(t).split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/`([^`]+)`/g, "<code>$1</code>")}</p>`).join("");
const args = (a) => Object.entries(a || {}).map(([k, v]) => `${esc(k)}: ${esc(typeof v === "string" ? v : JSON.stringify(v))}`).join(", ");

export function assistenteHtml(sel, { header, tabbar, ex = EXEMPLOS }) {
  const it = ex.itens.find((i) => i.id === sel) || ex.itens[0];
  const modelo = ex.modelo.replace(/^gemini \((.+)\)$/, "Gemini ($1)");
  const perguntas = ex.itens.map((i) => `<button type="button" class="ask-q${i.id === it.id ? " on" : ""}" data-ask="${esc(i.id)}" ${i.id === it.id ? 'aria-current="true"' : ""}><span>${esc(i.pergunta)}</span><small>${esc(EXPERT[i.expert] || i.expert)}</small></button>`).join("");
  const passos = it.passos.map((p, n) => `<li><code>${esc(p.ferramenta)}</code>(${args(p.args)})<small>${esc(FERRAMENTA[p.ferramenta] || "")}</small></li>`).join("");
  const docs = it.documentos.map((d) => `<li><b>${esc(d.titulo)}</b><small>${esc(d.caminho)} · relevância ${num(d.score, 2)}</small></li>`).join("");
  return `<main>${header("Dados de exemplo", "Assistente", null, "inicio", `<span class="pill demo">Respostas de exemplo</span>`)}
  <div class="notice" role="note"><b>Respostas gravadas.</b> São respostas reais do assistente de energia (LangChain.js + ${esc(modelo)} + RAG), geradas na avaliação de ${dataBr(ex.gerado_em)} sobre os dados de exemplo, como se hoje fosse ${dataBr(ex.hoje)}. Esta página não envia nada a uma IA nem a um banco. Perguntas livres rodam no laboratório local (<code>cd agent &amp;&amp; npm run ask</code>).</div>
  <div class="sect"><b>Escolha uma pergunta</b><span>Avaliação: <em>${esc(ex.acertos)}</em> aprovadas</span></div>
  <section class="ask-list" aria-label="Perguntas de exemplo">${perguntas}</section>
  <section class="card ask-chat" id="ask-resposta" aria-live="polite">
    <div class="ask-me">${esc(it.pergunta)}</div>
    ${it.cenario ? `<div class="foot note">${esc(it.cenario)}</div>` : ""}
    <div class="ask-bot">${paragrafos(it.resposta)}${it.fontes ? `<p class="ask-src">Fontes: ${esc(it.fontes)}</p>` : ""}</div>
  </section>
  <div class="cap">COMO O ASSISTENTE RESPONDEU</div>
  <section class="card ask-how">
    <div class="ask-step"><b>1. Roteador escolheu o expert ${esc(EXPERT[it.expert] || it.expert)}</b>${it.motivo ? `<small>“${esc(it.motivo)}”</small>` : ""}</div>
    <div class="ask-step"><b>2. Ferramentas chamadas pelo expert</b><ol>${passos}</ol></div>
    ${docs ? `<div class="ask-step"><b>3. Trechos recuperados no RAG</b><ul>${docs}</ul><small>Nesta rodada a busca híbrida usou o índice em memória, com a mesma interface do Weaviate do laboratório.</small></div>` : ""}
    <div class="ask-step"><b>${docs ? 4 : 3}. Checagem anti-alucinação</b><small>${it.conferidos ?? 0} números da resposta conferidos com o que as ferramentas devolveram${it.ok ? ": todos com fonte." : "."}</small></div>
    <div class="list"><div><span>Chamadas ao modelo</span><b>${esc(it.chamadas_llm ?? "—")}</b></div><div><span>Tokens (entrada + saída)</span><b>${it.tokens != null ? num(it.tokens) : "—"}</b></div><div><span>Tempo total</span><b>${num(it.ms / 1000, 1)} s</b></div></div>
  </section>
  <div class="foot">Código: <code>agent/</code> · perguntas em <code>agent/eval/dataset.json</code> · resultado em <code>agent/eval/results</code></div>
  </main>${tabbar("inicio")}`;
}

// Monta a tela e troca de pergunta sem recarregar (não há rede envolvida).
export function makeAssistente({ header, tabbar, $app, state }) {
  return async function viewAssistente() {
    const draw = (scroll) => {
      $app.innerHTML = assistenteHtml(state.ask, { header, tabbar });
      $app.querySelectorAll("[data-ask]").forEach((b) => b.onclick = () => { state.ask = b.dataset.ask; draw(true); });
      if (scroll) document.getElementById("ask-resposta")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    draw(false);
  };
}
