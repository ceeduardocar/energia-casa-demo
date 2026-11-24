// Corte de Markdown em trechos por título, com no máximo maxChars caracteres e o caminho do título em cada trecho.
export type Chunk = { colecao: string; titulo: string; caminho: string; texto: string };

export function chunkMarkdown(md: string, caminho: string, colecao: string, maxChars = 1200): Chunk[] {
  const out: Chunk[] = [];
  const stack: string[] = [];
  let buf: string[] = [];
  let inCode = false;
  const flush = () => {
    const body = buf.join("\n").trim();
    buf = [];
    if (!body) return;
    const titulo = stack.filter(Boolean).join(" > ") || caminho;
    for (const part of splitLong(body, maxChars)) out.push({ colecao, titulo, caminho, texto: part });
  };
  for (const line of md.split(/\r?\n/)) {
    if (/^```/.test(line)) inCode = !inCode;
    const h = !inCode && /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = h[1].length;
      stack.length = level - 1;
      stack[level - 1] = h[2].trim();
      continue;
    }
    buf.push(line);
  }
  flush();
  return out;
}

// Divide por parágrafo; um parágrafo maior que o limite é dividido por frase. Cada parte repete a última frase da anterior.
export function splitLong(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const sentences = text.split(/(?<=[.!?:])\s+|\n{2,}/).filter(Boolean);
  const parts: string[] = [];
  let cur = "", last = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length + 1 > max) {
      parts.push(cur.trim());
      cur = last && last.length < max / 3 ? last + " " : "";
    }
    if (s.length > max) {
      for (let i = 0; i < s.length; i += max) parts.push(s.slice(i, i + max));
      cur = "";
      last = "";
      continue;
    }
    cur += s + " ";
    last = s;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
