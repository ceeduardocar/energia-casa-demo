// Data de "hoje" no fuso da casa. AGENT_TODAY (AAAA-MM-DD) fixa a data, para a avaliação ser reprodutível.
import { TZ, addDays } from "../../app/util.js";

export type Clock = { today: () => string };

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export const systemClock = (): Clock => ({
  today: () => process.env.AGENT_TODAY || fmt.format(new Date()),
});

export const fixedClock = (day: string): Clock => ({ today: () => day });

export { addDays };
