import { sum, isNum, kwh, pct, sunUp, ageText, esc } from "./util.js";
import { hourlyLines } from "./charts.js";

// Ilustração da casa. Noite: a atual. Dia: quando existir uma versão diurna, é só trocar null pelo caminho
// (por exemplo "assets/casa-dia.webp"); enquanto isso a noturna serve nos dois casos.
const IMAGES = { night: "assets/casa-noite.webp", day: null };

// Pontos sobre a casa, em % da ilustração (proporção fixa, então não deslizam em outras larguras).
const AT = { solar: [41, 21], casa: [52, 56], rede: [83, 82], ar: [26, 42], boiler: [66, 31], piscina: [74, 19], carro: [30, 62] };
// Caminhos do fluxo na mesma grade (viewBox 1000 x 625): painéis -> quadro, quadro <-> rede.
const PATH = { solar: "M410 131 C485 150 525 175 530 262 L520 350", rede: "M520 350 L830 512" };

export function makeHouseHtml({ header, tabbar, svg, flowOf, C }) {
  const pin = (key, color, icon, name, value, note, on = true) => {
    const [x, y] = AT[key];
    return `<div class="pin${on ? "" : " off"}" style="--x:${x};--y:${y};--c:${color}"><span class="dotc">${svg(icon, 18, "currentColor", 2)}</span><span class="lab">${name}<strong>${value}</strong>${note ? `<small>${note}</small>` : ""}</span></div>`;
  };
  const stroke = (w) => Math.round(8 + Math.min(Math.max(w || 0, 0) / 1000, 6) * 6);

  return function houseHtml(h, { today, pill }) {
    const hrs = h.hourly, { m, fl, grid, ac, bo, exporting, paused, P, why } = flowOf(h);
    const tg = sum(hrs, "g"), tc = sum(hrs, "consumo"), ti = sum(hrs, "i"), te = sum(hrs, "e");
    const nowIdx = hrs.length ? +hrs.at(-1).hour_local.slice(11, 13) : null;
    const hourly = (k) => Array.from({ length: 24 }, (_, i) => { const r = hrs.find(x => +x.hour_local.slice(11, 13) === i); return r ? r[k] : null; });
    const saldo = isNum(te) || isNum(ti) ? (te || 0) - (ti || 0) : null;
    const self = isNum(tg) && tg > 0 ? Math.min(Math.max((tg - (te || 0)) / tg, 0), 1) : null;
    const day = sunUp(today.hour), src = (day && IMAGES.day) || IMAGES.night, isNight = src === IMAGES.night;
    const onW = (w) => isNum(w) && w > 30;
    const solarNote = paused ? "pausa noturna" : ageText(fl.gAge), gridNote = ageText(fl.gridAge);
    const consumoTxt = isNum(fl.consumo) ? P(fl.consumo) : "—";
    const gridName = exporting ? "Injetando na rede" : "Puxando da rede";
    const apTxt = (w) => !isNum(w) ? "sem dado" : onW(w) ? P(w) : "desligado";
    const pins = [
      pin("solar", C.amb, "sun", "Geração solar", P(fl.g), `Hoje ${kwh(tg)} kWh`, isNum(fl.g) && fl.g > 20),
      pin("casa", C.cy, "home", "Consumo da casa", consumoTxt, `Hoje ${kwh(tc)} kWh`),
      pin("rede", C.grid, "bolt", gridName, P(grid), `Hoje ${kwh(exporting ? te : ti)} kWh`),
      pin("ar", C.vio, "snow", "Ar-cond.", apTxt(ac), "", onW(ac)),
      pin("boiler", C.pink, "flame", "Boiler", apTxt(bo), "", onW(bo)),
      h.pool ? pin("piscina", C.vio, "pool", "Piscina", "bomba ligada", "", true) : "",
      h.car ? pin("carro", C.cy, "car", "Carro", "recarga hoje", "", true) : ""
    ].join("");
    const row = (color, name, value, note) => `<div><span class="nm"><i class="dot" style="background:${color}"></i>${name}</span><span class="r">${value}${note ? `<small>${note}</small>` : ""}</span></div>`;
    const flowLines = `<svg class="stage-flow" viewBox="0 0 1000 625" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path class="${isNum(fl.g) && fl.g > 20 ? "" : "off"}" d="${PATH.solar}" stroke="${C.amb}" stroke-width="${stroke(fl.g)}"/>
      <path class="${exporting ? "" : "rev"} ${isNum(grid) && grid > 20 ? "" : "off"}" d="${PATH.rede}" stroke="${C.grid}" stroke-width="${stroke(grid)}"/>
    </svg>`;
    return `<main>${header("Casa de exemplo", "Casa", { status: h.status }, null, pill)}
    <div class="casa-grid">
      <section class="stage" aria-label="Casa com a energia agora">
        <div class="stage-box"><img src="${src}" width="1586" height="992" alt="Ilustração da casa com os painéis solares no telhado, a garagem e a piscina${isNight ? ", à noite" : ""}" decoding="async">${flowLines}${pins}</div>
      </section>
      <div class="casa-col">
        <section class="card nowlist"><div class="top"><h2>Agora na casa</h2></div><div class="list">
          ${row(C.amb, "Geração solar", P(fl.g), solarNote)}${row(C.cy, "Consumo da casa", consumoTxt, isNum(fl.consumo) ? "calculado" : why ? "aguardando" : "")}${row(C.grid, gridName, P(grid), gridNote)}${row(C.vio, "Ar-cond.", apTxt(ac), "")}${row(C.pink, "Boiler", apTxt(bo), "")}${h.pool ? row(C.vio, "Piscina", "bomba ligada", "") : ""}${h.car ? row(C.cy, "Carro", "recarga hoje", "") : ""}
        </div></section>
        ${why ? `<div class="why">${svg("clock", 16, C.amb, 2)}<span>${esc(why)}</span></div>` : ""}
        <div class="tiles t2"><div class="tile"><div class="k">Saldo do dia</div><div class="v">${isNum(saldo) ? (saldo >= 0 ? "+" : "−") + kwh(Math.abs(saldo)) : "—"}<u>kWh</u></div><div class="s">Para a rede − da rede</div></div><div class="tile"><div class="k">Autoconsumo</div><div class="v">${isNum(self) ? pct(self) : "—"}</div><div class="s">Geração usada em casa</div></div></div>
        <section class="card"><div class="top"><h2>Geração × consumo por hora</h2><span class="unit">kWh</span></div>
          ${hourlyLines({ series: [{ values: hourly("g"), color: C.amb, area: true }, { values: hourly("consumo"), color: C.cy }], nowIdx, label: "Geração e consumo de hoje por hora", names: ["Geração", "Consumo"], unit: "kWh" })}
          <div class="legend"><span><i style="background:${C.amb}"></i>Geração</span><span><i style="background:${C.cy}"></i>Consumo</span></div></section>
      </div>
    </div></main>${tabbar("casa")}`;
  };
}
