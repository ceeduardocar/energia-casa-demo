// Normalização e tokens em português, comuns ao BM25 em memória e ao embedder local.
const STOP = new Set("a o e é de da do das dos em no na nos nas um uma uns umas para por com sem que se ao à às os as ou mais menos como qual quais quando onde porque por que foi ser são está estão isso esse essa este esta meu minha".split(" "));

export const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function tokens(s: string): string[] {
  return normalize(s).split(/[^a-z0-9_]+/).filter(t => t.length > 1 && !STOP.has(t));
}
