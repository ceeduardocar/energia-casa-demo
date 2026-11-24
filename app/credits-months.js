// Créditos mês a mês a partir das contas (funções puras, testadas em app/tests/credits-months.test.mjs).
// Regra da Neoenergia: o mínimo faturado (100 kWh) não sai dos créditos. Compensa-se só o consumo acima dele.
import { isNum } from "./util.js";
import { num, measured } from "./bills.js";

export const MIN_BILLED_KWH = 100;

const consumed = (b) => { const v = num(b.kwh_measured); return isNum(v) ? v : measured(b); };
const nextMonth = (ref) => { const y = +ref.slice(0, 4), m = +ref.slice(5, 7); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };

// Uma linha por conta, em ordem de mês:
// own = crédito do próprio mês usado; old = crédito de meses anteriores usado; net = injetado − compensado (sobra ou uso).
export function creditMonths(bills, min = MIN_BILLED_KWH) {
  return bills.filter(b => b.ref_month).map(b => {
    const c = consumed(b), inj = num(b.kwh_injected) ?? 0;
    const comp = isNum(c) ? Math.max(c - min, 0) : null;
    const own = comp == null ? null : Math.min(inj, comp);
    return {
      ref: String(b.ref_month).slice(0, 7), consumed: c, injected: inj, compensated: comp,
      own, old: comp == null ? null : comp - own, net: comp == null ? null : inj - comp, balance: num(b.credit_balance_kwh)
    };
  }).sort((a, b) => a.ref.localeCompare(b.ref));
}

// Conferência entre meses seguidos: saldo(mês) − saldo(anterior) deve ser igual ao saldo do mês (injetado − compensado).
export function balanceChecks(rows) {
  return rows.slice(1).map((r, i) => {
    const p = rows[i];
    if (nextMonth(p.ref) !== r.ref || !isNum(p.balance) || !isNum(r.balance) || !isNum(r.net)) return { ref: r.ref, status: "sem_dados" };
    const diff = +(r.balance - p.balance - r.net).toFixed(2);
    return { ref: r.ref, diff, status: Math.abs(diff) < 0.5 ? "ok" : "diferente" };
  });
}
