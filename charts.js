// Gráficos sencillos en SVG/HTML, sin librerías. Los colores salen de variables CSS (styles.css).
const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const eur = (n, decimals = 2) =>
  (n ?? 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: 'always' });
const short = (n) => (Math.abs(n) >= 1000 ? `${(n / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} k` : Math.round(n).toLocaleString('es-ES'));

// Barra con las esquinas de arriba redondeadas y apoyada en la línea base.
function bar(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceMax(v) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

// Ingresos y gastos de los últimos meses, en barras agrupadas.
// months: [{ label, title, income, expense }]
export function monthlyBars(months, current) {
  const W = 340, H = 190, L = 34, B = 24, T = 10;
  const max = niceMax(Math.max(...months.flatMap((m) => [m.income, m.expense])));
  const plotH = H - B - T;
  const slot = (W - L) / months.length;
  const bw = Math.min(16, (slot - 10) / 2);
  const y = (v) => T + plotH - (v / max) * plotH;
  const grid = [0, 0.5, 1].map((f) => {
    const v = max * f;
    return `<line class="grid${f === 0 ? ' base' : ''}" x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${short(v)}</text>`;
  }).join('');
  const groups = months.map((m, i) => {
    const cx = L + slot * i + slot / 2;
    const tip = `${m.title}|Ingresos: ${eur(m.income, 0)}|Gastos: ${eur(m.expense, 0)}|Ahorro: ${eur(m.income - m.expense, 0)}`;
    return `<g class="hit" data-tip="${esc(tip)}">
      <rect x="${cx - slot / 2}" y="${T}" width="${slot}" height="${plotH}" fill="transparent"/>
      <path class="s-income" d="${bar(cx - bw - 1, y(m.income), bw, T + plotH - y(m.income))}"/>
      <path class="s-expense" d="${bar(cx + 1, y(m.expense), bw, T + plotH - y(m.expense))}"/>
      <text class="tick${m.key === current ? ' now' : ''}" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(m.label)}</text>
    </g>`;
  }).join('');
  return `<div class="legend"><span><i class="s-income"></i>Ingresos</span><span><i class="s-expense"></i>Gastos</span></div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos y gastos por mes">${grid}${groups}</svg>`;
}

// Gasto por categoría: barras horizontales ordenadas de mayor a menor.
// rows: [{ id, name, emoji, value }]
export function categoryBars(rows, total) {
  if (!rows.length) return '<p class="empty">Aún no hay gastos este mes.</p>';
  const max = rows[0].value;
  return `<ul class="hbars">${rows.map((r) => `
    <li data-tip="${esc(`${r.name}|${eur(r.value)}|${Math.round((r.value / total) * 100)} % del gasto`)}">
      <a href="#/movimientos?cat=${r.id}">
        <span class="hb-label">${r.emoji} ${esc(r.name)}</span>
        <span class="hb-value">${eur(r.value, 0)}</span>
        <span class="hb-track"><span class="hb-fill" style="width:${Math.max(2, (r.value / max) * 100)}%"></span></span>
      </a>
    </li>`).join('')}</ul>`;
}

// Barra de presupuesto con estado (color + icono + texto, nunca solo color).
export function budgetMeter(spent, limit) {
  const pct = limit ? spent / limit : 0;
  const state = pct > 1 ? ['critical', '✕', 'Te has pasado'] : pct >= 0.8 ? ['warning', '!', 'Cerca del límite'] : ['good', '✓', 'Vas bien'];
  return `<div class="meter ${state[0]}">
    <div class="meter-track"><span style="width:${Math.min(100, pct * 100)}%"></span></div>
    <div class="meter-text"><span class="badge"><b>${state[1]}</b> ${state[2]}</span>
      <span>${eur(spent, 0)} de ${eur(limit, 0)} · ${Math.round(pct * 100)} %</span></div>
  </div>`;
}

// Tooltip compartido: funciona con ratón y con el dedo.
export function bindTooltips(root) {
  let tip = document.getElementById('tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  const show = (el, x, y) => {
    const [head, ...rest] = el.dataset.tip.split('|');
    tip.innerHTML = `<strong>${esc(head)}</strong>${rest.map((r) => `<span>${esc(r)}</span>`).join('')}`;
    tip.classList.add('show');
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2))}px`;
    tip.style.top = `${Math.max(8, y - tip.offsetHeight - 14)}px`;
    root.querySelectorAll('.hover').forEach((n) => n.classList.remove('hover'));
    el.classList.add('hover');
  };
  const hide = () => {
    tip.classList.remove('show');
    root.querySelectorAll('.hover').forEach((n) => n.classList.remove('hover'));
  };
  root.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') show(el, e.clientX, e.clientY); });
    el.addEventListener('pointerleave', hide);
    el.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') show(el, e.clientX, e.clientY); });
  });
  window.addEventListener('scroll', hide, { passive: true, once: true });
}
