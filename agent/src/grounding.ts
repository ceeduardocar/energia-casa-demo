// Checagem de números: todo número da resposta precisa aparecer na pergunta, nos argumentos ou nos resultados das
// ferramentas (com tolerância de arredondamento). Um número que não aparece em lugar nenhum é "sem fonte".

export type Grounding = { ok: boolean; verificados: number; sem_fonte: string[] };

// Números em português (1.938,67 ; 12,5 ; 62%) e em formato de máquina (2038.67).
const NUM = /(?<![\w.,])-?\d{1,3}(?:\.\d{3})+(?:,\d+)?(?![\w])|(?<![\w.,])-?\d+(?:[.,]\d+)?(?![\w])/g;

export function parsePt(s: string): { value: number; decimals: number } {
  let t = s;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(",", ".");
  const dec = t.includes(".") ? t.split(".")[1].length : 0;
  return { value: Number(t), decimals: dec };
}

const DATES = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|\b\d{1,2}:\d{2}\b/g;

// Números de um texto, com a marca de porcentagem quando vêm seguidos de "%".
export function numberTokens(text: string): { raw: string; pct: boolean }[] {
  // Datas (2026-11-19, 19/11/2026, 19/11) e horas não são checadas.
  const sem = text.replace(DATES, " ");
  return [...sem.matchAll(NUM)].map(m => ({ raw: m[0], pct: /^\s?%/.test(sem.slice(m.index! + m[0].length)) }));
}

export function numbersInText(text: string): string[] {
  return numberTokens(text).map(t => t.raw);
}

export function collectNumbers(x: unknown, out: number[] = []): number[] {
  if (typeof x === "number" && Number.isFinite(x)) out.push(x);
  else if (typeof x === "string") {
    // Mesmo corte da resposta (milhar com ponto), mais as partes de datas, que a resposta pode citar soltas.
    for (const m of x.match(NUM) ?? []) out.push(parsePt(m).value);
    for (const d of x.match(DATES) ?? []) for (const p of d.split(/[-/:]/)) out.push(Number(p));
  } else if (Array.isArray(x)) x.forEach(v => collectNumbers(v, out));
  else if (x && typeof x === "object") Object.values(x).forEach(v => collectNumbers(v, out));
  return out;
}

export function checkNumbers(answer: string, sources: unknown[]): Grounding {
  const allowed = collectNumbers(sources);
  const found = numberTokens(answer);
  const sem: string[] = [];
  for (const { raw, pct } of found) {
    const { value, decimals } = parsePt(raw);
    const tol = Math.max(0.5 * 10 ** -decimals, 1e-9) + 1e-9;
    // Fração da ferramenta (0,62) só vale como 62 quando a resposta diz "62%".
    const hit = allowed.some(a => Math.abs(Math.abs(a) - Math.abs(value)) <= tol || (pct && Math.abs(Math.abs(a) * 100 - Math.abs(value)) <= tol));
    if (!hit) sem.push(raw);
  }
  return { ok: sem.length === 0, verificados: found.length, sem_fonte: sem };
}
