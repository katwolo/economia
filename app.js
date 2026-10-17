import { db } from './db.js';
import { CATEGORIES, GROUPS, catById, categorize, conceptKey } from './categories.js';
import { readFile } from './importer.js';
import { monthlyBars, categoryBars, budgetMeter, bindTooltips, eur } from './charts.js';
import { api, DEFAULT_URL, getConfig, setConfig, isConfigured, getTombstones, addTombstone, clearTombstones, resetTombstones } from './sync.js';

const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const nav = $('#nav');

const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Se muestra en Ajustes para saber qué versión tiene cada móvil (igual que CACHE en sw.js).
const APP_VERSION = 6;

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  file: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7M9 7h4"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
};
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------- Fechas ----------
const today = () => new Date().toISOString().slice(0, 10);
const monthOf = (date) => date.slice(0, 7);
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthsBetween = (from, to) => {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
};
const monthName = (ym, opts = { month: 'long', year: 'numeric' }) =>
  new Date(`${ym}-01T00:00`).toLocaleDateString('es-ES', opts);
const fmtDay = (s) => new Date(s + 'T00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = (s) => new Date(s + 'T00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
const lastDay = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate();

// ---------- Almacenamiento local seguro ----------
const store = {
  get(k, def = '') { try { return localStorage.getItem(k) ?? def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};

// ---------- Estado ----------
// Los movimientos van en su propio almacén; el resto son listas de registros que se sincronizan
// igual que los movimientos (cada registro con id y updatedAt).
const TABLES = ['budgets', 'rules', 'fixed', 'goals', 'settings'];
let movs = [];
const T = { budgets: [], rules: [], fixed: [], goals: [], settings: [] };
let budgets = {}; // { categoría: límite mensual }, calculado a partir de T.budgets
let month = monthOf(today());
let query = '';
let filter = 'all';
let who = 'all'; // filtro "de quién" en el resumen y en los movimientos
let review = null; // movimientos leídos de un archivo, pendientes de confirmar
let receipt = null; // ticket leído, pendiente de confirmar

// ---------- Pareja ----------
// "comun" = de los dos (lo normal); "p1" y "p2" = de cada uno.
const names = () => {
  const get = (id, def) => (T.settings.find((s) => s.id === id)?.value || '').trim() || def;
  return { p1: get('p1', 'Persona 1'), p2: get('p2', 'Persona 2') };
};
const whoName = (id) => (id === 'p1' || id === 'p2' ? names()[id] : 'Los dos');
const me = () => store.get('economia.me'); // de quién es este móvil ("p1", "p2" o vacío)

// ---------- Estilo ----------
// Oscuro (por defecto) o claro. Se guarda en cada móvil, no se sincroniza.
const theme = () => (store.get('economia.theme') === 'light' ? 'light' : 'dark');
function applyTheme(t) {
  store.set('economia.theme', t);
  if (t === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  $('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f6f5f2' : '#121214');
}

async function load() {
  const [list, ...saved] = await Promise.all([db.all('movs'), ...TABLES.map((k) => db.get('meta', k))]);
  movs = list.map((m) => ({ who: 'comun', addedBy: '', fixedId: '', ...m }));
  TABLES.forEach((k, i) => (T[k] = saved[i] || []));
  // Versión anterior: presupuestos como { categoría: límite } y reglas sin id.
  if (!Array.isArray(T.budgets)) {
    T.budgets = Object.entries(T.budgets).map(([id, limit]) => ({ id, limit, updatedAt: Date.now(), dirty: true }));
  }
  T.rules = T.rules.map((r) => ({ id: r.key, updatedAt: Date.now(), dirty: true, ...r, key: r.key || r.id }));
  refreshBudgets();
  // Si este mes no hay nada, empieza por el último mes con movimientos.
  if (movs.length && !movs.some((m) => monthOf(m.date) === month)) {
    month = monthOf(movs.reduce((a, b) => (a.date > b.date ? a : b)).date);
  }
}

const refreshBudgets = () => {
  budgets = Object.fromEntries(T.budgets.filter((r) => r.limit > 0).map((r) => [r.id, r.limit]));
};

const saveMov = (m) => {
  m.updatedAt = Date.now();
  m.dirty = true;
  scheduleSync();
  return db.put('movs', m);
};
const saveTables = () => Promise.all(TABLES.map((k) => db.put('meta', T[k], k)));
const saveMeta = () => {
  scheduleSync();
  return saveTables();
};

// Crea o actualiza un registro de una tabla (gasto fijo, objetivo, ajuste...).
function upsert(table, rec) {
  const list = T[table];
  const old = list.find((r) => r.id === rec.id);
  const now = Date.now();
  if (old) Object.assign(old, rec, { updatedAt: now, dirty: true });
  else list.push({ createdAt: now, ...rec, updatedAt: now, dirty: true });
  return saveMeta();
}
function removeRec(table, id) {
  const r = T[table].find((x) => x.id === id);
  if (r?.remote) addTombstone(table, id);
  T[table] = T[table].filter((x) => x.id !== id);
  return saveMeta();
}

async function removeMov(id, { tombstone = true } = {}) {
  const m = movs.find((x) => x.id === id);
  if (tombstone && m?.remote) addTombstone('movs', id);
  movs = movs.filter((x) => x.id !== id);
  await Promise.all([db.del('movs', id), db.del('blobs', id)]);
  if (tombstone) scheduleSync();
}

function newMov(fields) {
  const amount = Number(fields.amount) || 0;
  const m = {
    id: uid(),
    date: fields.date || today(),
    concept: fields.concept || '',
    amount,
    category: fields.category || categorize(fields.concept || '', amount, T.rules),
    who: fields.who || 'comun',
    addedBy: me(),
    fixedId: fields.fixedId || '',
    note: fields.note || '',
    source: fields.source || 'manual',
    driveId: '',
    driveUrl: '',
    mime: '',
    hasFile: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dirty: true,
  };
  // Si coincide con un gasto fijo, queda enlazado (cuenta como pagado) y toma su categoría.
  const f = !m.fixedId && amount < 0 && fixedFor(m);
  if (f) Object.assign(m, { fixedId: f.id, category: fields.category || f.category });
  return m;
}

// Recuerda la categoría elegida para los próximos movimientos con un concepto parecido.
function learn(concept, category) {
  const key = conceptKey(concept);
  if (!key) return false;
  T.rules = [...T.rules.filter((r) => r.key !== key), { id: key, key, category, updatedAt: Date.now(), dirty: true }];
  saveMeta();
  return key;
}

const sameMov = (a, b) => a.date === b.date && Math.abs(a.amount - b.amount) < 0.005 &&
  conceptKey(a.concept) === conceptKey(b.concept);

// ---------- Gastos fijos ----------
// Un gasto fijo es un recibo que llega cada mes o cada N meses (luz, hipoteca, seguro anual...).
const activeFixed = () => T.fixed.filter((f) => !f.deleted);
const dueIn = (f, ym) => {
  const diff = monthsBetween(f.start || ym, ym);
  return diff >= 0 && diff % (Number(f.every) || 1) === 0;
};
// El concepto del banco se compara normalizado (también si se escribió a mano en la hoja).
const matchKey = (f) => conceptKey(f.match || '');
const fixedFor = (m) => {
  const key = conceptKey(m.concept);
  return key && activeFixed().find((f) => matchKey(f) === key);
};
// Pago de un gasto fijo en un mes: un movimiento enlazado o con el mismo concepto del banco.
const paymentOf = (f, ym) =>
  movs.find((m) => monthOf(m.date) === ym && m.amount < 0 &&
    (m.fixedId === f.id || (!m.fixedId && matchKey(f) && conceptKey(m.concept) === matchKey(f))));
const EVERY = { 1: 'Cada mes', 2: 'Cada 2 meses', 3: 'Cada 3 meses', 4: 'Cada 4 meses', 6: 'Cada 6 meses', 12: 'Una vez al año' };
// Lo que cuestan de media al mes los gastos fijos (los anuales, repartidos en 12 meses...).
const monthlyAverage = (list) => list.reduce((s, f) => s + Number(f.amount) / (Number(f.every) || 1), 0);

// Conceptos que se repiten cada mes y aún no son gastos fijos: candidatos a añadir.
function recurringCandidates() {
  const months = [0, 1, 2, 3].map((i) => shiftMonth(month, -i));
  const seen = new Map();
  for (const m of movs) {
    if (m.amount >= 0 || m.fixedId || !months.includes(monthOf(m.date))) continue;
    const key = conceptKey(m.concept);
    if (!key) continue;
    const e = seen.get(key) || { key, count: 0, amounts: [], months: new Set(), last: m };
    e.count++;
    e.amounts.push(-m.amount);
    e.months.add(monthOf(m.date));
    if (m.date >= e.last.date) e.last = m;
    seen.set(key, e);
  }
  const taken = new Set(activeFixed().map(matchKey));
  return [...seen.values()]
    .filter((e) => !taken.has(e.key) && e.months.size >= 3 && e.count <= e.months.size + 1)
    .filter((e) => catById(e.last.category).group === 'fijo' || Math.max(...e.amounts) <= Math.min(...e.amounts) * 1.1)
    .sort((a, b) => a.last.amount - b.last.amount);
}

// ---------- Cálculos ----------
const byWho = (list) => (who === 'all' ? list : list.filter((m) => (m.who || 'comun') === who));
const inMonth = (ym) => byWho(movs.filter((m) => monthOf(m.date) === ym));
// Un pago enlazado a un gasto fijo cuenta como fijo aunque su categoría sea de variables
// (por ejemplo, la cuota del gimnasio); el ahorro y los ingresos no cambian.
const groupOf = (m) => {
  const g = catById(m.category).group;
  return m.fixedId && m.amount < 0 && g === 'variable' ? 'fijo' : g;
};

function totals(list) {
  const t = { income: 0, fijo: 0, variable: 0, ahorro: 0 };
  for (const m of list) {
    const g = groupOf(m);
    if (g === 'ingreso') t.income += m.amount;
    else t[g] -= m.amount; // las devoluciones (positivas) restan gasto
  }
  t.expense = t.fijo + t.variable;
  t.saving = t.income - t.expense; // lo que queda (incluye lo apartado a ahorro)
  return t;
}
function byCategory(list, group) {
  const map = new Map();
  for (const m of list) {
    const c = catById(m.category);
    if (c.kind !== 'gasto' || (group && groupOf(m) !== group)) continue;
    map.set(c.id, (map.get(c.id) || 0) - m.amount);
  }
  return [...map.entries()]
    .map(([id, value]) => ({ ...catById(id), value }))
    .filter((r) => r.value > 0.005)
    .sort((a, b) => b.value - a.value);
}
// Regla 50/30/20: necesidades, caprichos y ahorro sobre lo que entra.
function rule503020(list) {
  let need = 0, want = 0, income = 0;
  for (const m of list) {
    const c = catById(m.category);
    if (c.kind === 'ingreso') income += m.amount;
    else if (c.group === 'ahorro') continue;
    else if (c.need) need -= m.amount;
    else want -= m.amount;
  }
  return { income, need, want, save: income - need - want };
}

// ---------- Aviso ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- Piezas de las vistas ----------
const catOptions = (selected, groups = ['fijo', 'variable', 'ahorro', 'ingreso']) =>
  groups.map((g) => `<optgroup label="${GROUPS[g]}">${CATEGORIES.filter((c) => c.group === g)
    .map((c) => `<option value="${c.id}"${c.id === selected ? ' selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('')}</optgroup>`).join('');

// Selector "¿De quién?": los dos (por defecto) o cada uno.
function whoPicker(name, selected = 'comun') {
  const n = names();
  return `<div class="seg seg3" role="radiogroup" aria-label="¿De quién?">
    ${[['comun', 'Los dos'], ['p1', n.p1], ['p2', n.p2]].map(([v, l]) =>
      `<label><input type="radio" name="${name}" value="${v}" ${selected === v ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}
  </div>`;
}
const whoBadge = (id) => (id === 'p1' || id === 'p2' ? `<span class="who-badge">${esc(names()[id])}</span>` : '');

function whoChips() {
  const n = names();
  return `<div class="chips">${[['all', 'Todo'], ['comun', 'Los dos'], ['p1', n.p1], ['p2', n.p2]].map(([k, l]) =>
    `<button data-who="${k}" aria-pressed="${who === k}">${esc(l)}</button>`).join('')}</div>`;
}

function movRow(m) {
  const c = catById(m.category);
  return `<li><a class="row" href="#/mov/${m.id}">
    <span class="cat-ic">${c.emoji}</span>
    <span class="row-main"><strong>${esc(m.concept || c.name)}</strong>
      <span>${esc(c.name)} · ${fmtShort(m.date)}${m.fixedId ? ' · fijo' : ''}</span></span>
    ${whoBadge(m.who)}
    <span class="amt ${m.amount >= 0 ? 'pos' : ''}">${m.amount >= 0 ? '+' : ''}${eur(m.amount)}</span>
  </a></li>`;
}

function monthPicker() {
  return `<div class="month-pick">
    <button class="icon-btn" data-month="-1" aria-label="Mes anterior">${icon('prev')}</button>
    <strong>${monthName(month)}</strong>
    <button class="icon-btn" data-month="1" aria-label="Mes siguiente">${icon('next')}</button>
  </div>`;
}

// Barra de progreso con estado (color + icono + texto).
function meter(pct, state, label, detail) {
  const icons = { good: '✓', warning: '!', critical: '✕' };
  return `<div class="meter ${state}">
    <div class="meter-track"><span style="width:${Math.max(0, Math.min(100, pct))}%"></span></div>
    <div class="meter-text"><span class="badge"><b>${icons[state]}</b> ${label}</span><span>${detail}</span></div>
  </div>`;
}

// ---------- Resumen ----------
function viewHome() {
  if (!movs.length && !T.fixed.length) {
    return `<div class="top-bar"><span></span><a class="icon-btn" href="#/mas" aria-label="Ajustes">${icon('gear')}</a></div>
      <section class="hero"><h1>Economía familiar</h1>
      <p class="muted">Para empezar, sube el extracto del banco o una foto de un ticket, o apunta vuestros gastos fijos (hipoteca, luz, seguros...).</p></section>
      ${importCard()}
      <a class="card hint" href="#/fijo/nuevo">${icon('plus')}<span><strong>Apuntar los gastos fijos</strong><br>
        <span class="muted">Los recibos que llegan cada mes o cada cierto tiempo.</span></span></a>
      ${isConfigured() ? '' : `<div class="card stack">
        <h2>¿Quieres verla con datos?</h2>
        <p class="prose">Carga unos meses de ejemplo para ver cómo funciona. Luego puedes borrarlos desde <em>Ajustes</em>.</p>
        <button class="btn" data-action="demo">Cargar datos de ejemplo</button>
      </div>`}`;
  }
  const list = inMonth(month);
  const t = totals(list);
  const series = [-5, -4, -3, -2, -1, 0].map((i) => {
    const ym = shiftMonth(month, i);
    const tt = totals(inMonth(ym));
    return { key: ym, label: monthName(ym, { month: 'short' }).replace('.', ''), title: monthName(ym), income: tt.income, expense: tt.expense };
  });
  const rate = t.income > 0 ? Math.round((t.saving / t.income) * 100) : null;
  const due = activeFixed().filter((f) => dueIn(f, month) && (who === 'all' || (f.who || 'comun') === who));
  const pending = due.filter((f) => !paymentOf(f, month)).sort((a, b) => a.day - b.day);
  const variableCats = byCategory(list, 'variable');
  const pct = (v) => (t.income > 0 ? `${Math.round((v / t.income) * 100)} %` : '');
  const minus = (v) => (Math.round(v) ? `−${eur(v, 0)}` : eur(0, 0));
  const allMonth = movs.filter((m) => monthOf(m.date) === month);
  const perWho = ['comun', 'p1', 'p2'].map((w) => ({ w, ...totals(allMonth.filter((m) => (m.who || 'comun') === w)) }));
  return `<div class="top-bar">${monthPicker()}<a class="icon-btn" href="#/mas" aria-label="Ajustes">${icon('gear')}</a></div>
    ${whoChips()}
    <section class="tiles">
      <div class="tile main"><span>Os queda este mes</span><strong class="${t.saving < 0 ? 'neg' : ''}">${eur(t.saving)}</strong>
        <small>${rate === null ? 'Sin ingresos registrados' : t.saving >= 0 ? `Ahorráis el ${rate} % de lo que entra` : 'Gastáis más de lo que entra'}</small></div>
    </section>

    <section class="card">
      <h2>¿A dónde va el dinero?</h2>
      <ul class="flow">
        <li><span>💶 Ingresos</span><strong class="pos">${eur(t.income, 0)}</strong></li>
        <li><a href="#/fijos"><span>🏠 Gastos fijos</span><strong>${minus(t.fijo)}</strong><small>${pct(t.fijo)}</small></a></li>
        <li><a href="#/movimientos"><span>🛒 Gastos variables</span><strong>${minus(t.variable)}</strong><small>${pct(t.variable)}</small></a></li>
        ${t.ahorro ? `<li><a href="#/presupuesto"><span>🐷 Apartado a ahorro</span><strong>${minus(t.ahorro)}</strong><small>${pct(t.ahorro)}</small></a></li>` : ''}
        <li class="total"><span>Queda</span><strong class="${t.saving - t.ahorro < 0 ? 'neg' : ''}">${eur(t.saving - t.ahorro, 0)}</strong></li>
      </ul>
    </section>

    ${due.length ? `<a class="card fixed-sum" href="#/fijos">
      <div class="section-head"><h2>Gastos fijos del mes</h2><span class="count">${due.length - pending.length} de ${due.length} pagados</span></div>
      ${meter(due.length ? ((due.length - pending.length) / due.length) * 100 : 0, pending.length ? 'warning' : 'good',
        pending.length ? `Faltan ${pending.length}` : 'Todo pagado',
        pending.length ? `${eur(pending.reduce((s, f) => s + Number(f.amount), 0), 0)} pendientes` : '')}
      ${pending.slice(0, 3).map((f) => `<p class="pending-line">${catById(f.category).emoji} ${esc(f.name)} <span>día ${f.day} · ${eur(f.amount, 0)}</span></p>`).join('')}
    </a>` : activeFixed().length ? '' : `<a class="card hint" href="#/fijos">${icon('plus')}<span><strong>Apunta vuestros gastos fijos</strong><br>
      <span class="muted">Hipoteca, luz, seguros, colegio... y verás cada mes qué está pagado y qué falta.</span></span></a>`}

    <section class="card"><h2>Últimos 6 meses</h2>${monthlyBars(series, month)}</section>

    <section class="card"><div class="section-head"><h2>Gastos variables</h2><span class="count">${eur(t.variable, 0)}</span></div>
      ${categoryBars(variableCats, t.variable)}
      <a class="link" href="#/presupuesto">Ver presupuesto</a></section>

    ${perWho.some((p) => p.w !== 'comun' && (p.expense || p.income)) ? `<section class="card"><h2>¿Quién ha gastado?</h2>
      <ul class="flow">${perWho.map((p) => `<li><a href="#" data-who-go="${p.w}"><span>${esc(whoName(p.w))}</span>
        <strong>${eur(p.expense, 0)}</strong><small>${p.income ? `+${eur(p.income, 0)}` : ''}</small></a></li>`).join('')}</ul>
    </section>` : ''}

    <section class="card"><div class="section-head"><h2>Últimos movimientos</h2><a class="link" href="#/movimientos">Ver todos</a></div>
      <ul class="list">${list.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map(movRow).join('') || '<li class="empty">Nada este mes.</li>'}</ul>
    </section>`;
}

// ---------- Gastos fijos ----------
function viewFixed() {
  const all = activeFixed();
  const due = all.filter((f) => dueIn(f, month));
  const rest = all.filter((f) => !dueIn(f, month));
  const paid = due.filter((f) => paymentOf(f, month));
  const pending = due.filter((f) => !paymentOf(f, month)).sort((a, b) => a.day - b.day);
  const sum = (l) => l.reduce((s, f) => s + Number(f.amount), 0);
  const paidSum = paid.reduce((s, f) => s - paymentOf(f, month).amount, 0);
  const irregular = all.filter((f) => Number(f.every) > 1);
  const provision = monthlyAverage(irregular);
  const candidates = recurringCandidates();
  const row = (f) => {
    const p = paymentOf(f, month);
    const c = catById(f.category);
    const diff = p ? -p.amount - Number(f.amount) : 0;
    return `<li class="fx${p ? ' paid' : ''}">
      <a class="row" href="#/fijo/${f.id}">
        <span class="cat-ic">${c.emoji}</span>
        <span class="row-main"><strong>${esc(f.name)}</strong>
          <span>Día ${f.day} · ${EVERY[f.every] || EVERY[1]}${f.who && f.who !== 'comun' ? ` · ${esc(whoName(f.who))}` : ''}</span>
          ${p ? `<small class="${diff > 0.5 ? 'neg' : ''}">Pagado el ${fmtShort(p.date)}: ${eur(-p.amount)}${Math.abs(diff) > 0.5 ? ` (${diff > 0 ? '+' : ''}${eur(diff)})` : ''}</small>` : ''}</span>
        <span class="amt">${eur(f.amount)}</span>
      </a>
      ${p ? `<span class="paid-mark" aria-label="Pagado">${icon('check')}</span>`
        : `<button class="btn small" data-pay="${f.id}">Pagar</button>`}
    </li>`;
  };
  return `<div class="page-head"><h1>Gastos fijos</h1><a class="icon-btn" href="#/fijo/nuevo" aria-label="Añadir gasto fijo">${icon('plus')}</a></div>
    ${monthPicker()}
    <section class="tiles three">
      <div class="tile"><span>Este mes</span><strong>${eur(sum(due), 0)}</strong></div>
      <div class="tile"><span>Pagado</span><strong>${eur(paidSum, 0)}</strong></div>
      <div class="tile"><span>Falta</span><strong class="${pending.length ? 'warn' : ''}">${eur(sum(pending), 0)}</strong></div>
    </section>
    ${irregular.length ? `<p class="note">Hay recibos que no llegan cada mes (${irregular.map((f) => esc(f.name)).slice(0, 3).join(', ')}${irregular.length > 3 ? '…' : ''}).
      Para que no os pillen por sorpresa, apartad <strong>${eur(provision, 0)} al mes</strong> para ellos.</p>` : ''}
    ${all.length ? `<p class="prose">De media, los gastos fijos son <strong>${eur(monthlyAverage(all), 0)} al mes</strong>.</p>` : ''}
    ${pending.length ? `<h3 class="day">Pendientes</h3><ul class="list">${pending.map(row).join('')}</ul>` : ''}
    ${paid.length ? `<h3 class="day">Pagados</h3><ul class="list">${paid.map(row).join('')}</ul>` : ''}
    ${!due.length ? `<p class="empty">${all.length ? 'Este mes no toca ningún recibo.' : 'Aún no hay gastos fijos. Añade la hipoteca o el alquiler, la luz, los seguros...'}</p>` : ''}
    ${rest.length ? `<details class="card"><summary>No tocan este mes (${rest.length})</summary><ul class="list">${rest.map((f) => `<li><a class="row" href="#/fijo/${f.id}">
      <span class="cat-ic">${catById(f.category).emoji}</span><span class="row-main"><strong>${esc(f.name)}</strong>
      <span>${EVERY[f.every]} · próximo: ${monthName(nextDue(f), { month: 'long' })}</span></span><span class="amt">${eur(f.amount)}</span></a></li>`).join('')}</ul></details>` : ''}
    ${candidates.length ? `<section class="card"><h2>Se repiten cada mes</h2>
      <p class="prose">Estos pagos aparecen todos los meses en vuestros movimientos. ¿Los añadimos como gastos fijos?</p>
      <ul class="list">${candidates.map((e) => `<li class="row"><span class="cat-ic">${catById(e.last.category).emoji}</span>
        <span class="row-main"><strong>${esc(e.last.concept)}</strong><span>Día ${Number(e.last.date.slice(8))} · ${eur(-e.last.amount)}</span></span>
        <a class="btn small" href="#/fijo/nuevo?from=${e.last.id}">Añadir</a></li>`).join('')}</ul></section>` : ''}
    <a class="btn wide" href="#/fijo/nuevo">${icon('plus')} Añadir gasto fijo</a>`;
}

function nextDue(f) {
  for (let i = 1; i <= 12; i++) if (dueIn(f, shiftMonth(month, i))) return shiftMonth(month, i);
  return month;
}

function viewFixedEditor(id, params) {
  const isNew = id === 'nuevo';
  const from = movs.find((m) => m.id === params.get('from'));
  const f = isNew
    ? { name: from ? from.concept : '', category: from ? from.category : 'suministros', amount: from ? -from.amount : '',
      day: from ? Number(from.date.slice(8)) : 1, every: 1, start: month, who: from?.who || 'comun', match: from ? conceptKey(from.concept) : '' }
    : T.fixed.find((x) => x.id === id);
  if (!f) return '<p class="empty">Este gasto fijo ya no existe.</p>';
  return `<div class="page-head"><a class="icon-btn" href="#/fijos" aria-label="Volver">${icon('back')}</a>
    <h1>${isNew ? 'Nuevo gasto fijo' : 'Gasto fijo'}</h1>
    ${isNew ? '' : `<button class="icon-btn danger" data-action="delete-fixed" aria-label="Borrar">${icon('trash')}</button>`}</div>
    <form id="fixed-form" class="form" data-id="${isNew ? '' : f.id}">
      <label class="field"><span>Nombre</span><input name="name" required value="${esc(f.name)}" placeholder="Ej.: Hipoteca, luz, seguro del coche" maxlength="80"></label>
      <label class="field"><span>Importe (€)</span>
        <input name="amount" inputmode="decimal" required class="big-input" placeholder="0,00" value="${f.amount === '' ? '' : Number(f.amount).toFixed(2).replace('.', ',')}"></label>
      <label class="field"><span>Categoría</span><select name="category">${catOptions(f.category, ['fijo', 'variable', 'ahorro'])}</select></label>
      <div class="two">
        <label class="field"><span>Día de cobro</span><input name="day" type="number" min="1" max="31" value="${f.day}"></label>
        <label class="field"><span>¿Cada cuánto?</span><select name="every">${Object.entries(EVERY).map(([v, l]) =>
          `<option value="${v}"${Number(f.every) === Number(v) ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Primer mes que se paga</span><input name="start" type="month" value="${f.start || month}"></label>
      <div class="field"><span>¿De quién?</span>${whoPicker('who', f.who || 'comun')}</div>
      <label class="field"><span>Cómo aparece en el banco (opcional)</span>
        <input name="match" value="${esc(f.match || '')}" placeholder="Ej.: endesa energia">
        <small class="muted">Si un movimiento importado lo contiene, el recibo se marca como pagado solo.</small></label>
      <button class="btn primary wide">${isNew ? 'Guardar' : 'Guardar cambios'}</button>
    </form>`;
}

// Registra el pago de un gasto fijo como movimiento del mes que se está viendo.
async function payFixed(id) {
  const f = T.fixed.find((x) => x.id === id);
  if (!f) return;
  const day = Math.min(Number(f.day) || 1, lastDay(month));
  const m = newMov({ date: `${month}-${String(day).padStart(2, '0')}`, concept: f.name, amount: -Number(f.amount),
    category: f.category, who: f.who || 'comun', fixedId: f.id, source: 'fijo' });
  await db.put('movs', m);
  movs.push(m);
  scheduleSync(1000);
  toast(`${f.name}: pagado`);
  render();
}

// ---------- Presupuesto ----------
function viewBudget() {
  const list = inMonth(month);
  const t = totals(list);
  const due = activeFixed().filter((f) => dueIn(f, month));
  const plannedFixed = due.reduce((s, f) => s + Number(f.amount), 0);
  const variableCats = CATEGORIES.filter((c) => c.group === 'variable');
  const plannedVar = variableCats.reduce((s, c) => s + (budgets[c.id] || 0), 0);
  const prev = [1, 2, 3].map((i) => totals(inMonth(shiftMonth(month, -i))));
  const plannedIncome = prev.reduce((s, x) => s + x.income, 0) / 3 || t.income;
  const goalsMonthly = T.goals.filter((g) => !g.deleted).reduce((s, g) => s + goalMonthly(g), 0);
  const spent = new Map(byCategory(list, 'variable').map((c) => [c.id, c.value]));
  const avg = new Map();
  for (let i = 1; i <= 3; i++) for (const c of byCategory(inMonth(shiftMonth(month, -i)), 'variable')) avg.set(c.id, (avg.get(c.id) || 0) + c.value / 3);
  const r = rule503020(list);
  const share = (v) => (r.income > 0 ? (v / r.income) * 100 : 0);
  const planRow = (label, planned, real, positiveIsGood) => {
    const diff = real - planned;
    const bad = positiveIsGood ? diff < -1 : diff > 1;
    return `<tr><th>${label}</th><td>${planned ? eur(planned, 0) : '—'}</td><td>${eur(real, 0)}</td>
      <td class="${planned ? (bad ? 'neg' : 'pos') : ''}">${planned ? `${diff > 0 ? '+' : ''}${eur(diff, 0)}` : ''}</td></tr>`;
  };
  return `<div class="page-head"><h1>Presupuesto</h1></div>
    ${monthPicker()}
    <section class="card">
      <h2>Previsto y real</h2>
      <table class="plan">
        <thead><tr><th></th><th>Previsto</th><th>Real</th><th>Diferencia</th></tr></thead>
        <tbody>
          ${planRow('Ingresos', plannedIncome, t.income, true)}
          ${planRow('Gastos fijos', plannedFixed, t.fijo, false)}
          ${planRow('Gastos variables', plannedVar, t.variable, false)}
          ${planRow('Ahorro', Math.max(0, plannedIncome - plannedFixed - plannedVar), t.saving, true)}
        </tbody>
      </table>
      <p class="prose">Ingresos previstos: la media de los 3 meses anteriores. Fijos previstos: los recibos de este mes. Variables previstos: la suma de los presupuestos de abajo.</p>
    </section>

    <section class="card">
      <h2>Regla 50/30/20</h2>
      <p class="prose">Una guía muy usada: la mitad de lo que entra para lo necesario, un 30 % para caprichos y al menos un 20 % para ahorrar.</p>
      ${r.income > 0 ? `
        <div class="budget"><span class="hb-label">🏠 Necesidades (vivienda, recibos, comida, transporte, salud)</span>
          ${meter(share(r.need) * 2, share(r.need) <= 50 ? 'good' : share(r.need) <= 60 ? 'warning' : 'critical',
            `${Math.round(share(r.need))} %`, `objetivo 50 % · ${eur(r.need, 0)}`)}</div>
        <div class="budget"><span class="hb-label">🎟️ Caprichos (restaurantes, ocio, ropa, suscripciones)</span>
          ${meter((share(r.want) / 30) * 100, share(r.want) <= 30 ? 'good' : share(r.want) <= 40 ? 'warning' : 'critical',
            `${Math.round(share(r.want))} %`, `objetivo 30 % · ${eur(r.want, 0)}`)}</div>
        <div class="budget"><span class="hb-label">🐷 Ahorro (lo que queda)</span>
          ${meter((share(r.save) / 20) * 100, share(r.save) >= 20 ? 'good' : share(r.save) >= 10 ? 'warning' : 'critical',
            `${Math.round(share(r.save))} %`, `objetivo 20 % · ${eur(r.save, 0)}`)}</div>` : '<p class="empty">Hace falta algún ingreso este mes para calcularla.</p>'}
    </section>

    <section class="card">
      <div class="section-head"><h2>Objetivos de ahorro</h2><a class="link" href="#/objetivo/nuevo">Añadir</a></div>
      ${T.goals.filter((g) => !g.deleted).map((g) => {
        const pct = g.target ? (g.saved / g.target) * 100 : 0;
        return `<div class="goal">
          <a href="#/objetivo/${g.id}" class="goal-head"><strong>${esc(g.name)}</strong><span>${eur(g.saved, 0)} de ${eur(g.target, 0)}</span></a>
          ${meter(pct, pct >= 100 ? 'good' : 'warning', pct >= 100 ? '¡Conseguido!' : `${Math.round(pct)} %`,
            g.deadline && pct < 100 ? `${eur(goalMonthly(g), 0)}/mes hasta ${fmtShort(g.deadline)}` : '')}
          <button class="btn small" data-contribute="${g.id}">+ Aportar</button>
        </div>`;
      }).join('') || '<p class="prose">Vacaciones, un colchón para imprevistos, el coche... Pon una meta y la app os dice cuánto apartar cada mes.</p>'}
      ${goalsMonthly ? `<p class="prose">Para llegar a tiempo a todos: <strong>${eur(goalsMonthly, 0)} al mes</strong>.</p>` : ''}
    </section>

    <form id="budget-form" class="card">
      <h2>Presupuesto de gastos variables</h2>
      <p class="prose">Cuánto queréis gastar como máximo al mes en cada cosa. Al lado, la media de los 3 meses anteriores.</p>
      ${variableCats.map((c) => `<div class="budget-row">
        <label for="b-${c.id}"><span>${c.emoji} ${esc(c.name)}</span>
          <small class="muted">Media: ${eur(avg.get(c.id) || 0, 0)}</small></label>
        <input id="b-${c.id}" name="${c.id}" inputmode="decimal" placeholder="Sin límite" value="${budgets[c.id] ? String(budgets[c.id]).replace('.', ',') : ''}">
        ${budgets[c.id] ? budgetMeter(spent.get(c.id) || 0, budgets[c.id]) : ''}
      </div>`).join('')}
      <button class="btn primary wide">Guardar presupuesto</button>
    </form>`;
}

// Cuánto hay que apartar cada mes para llegar a la meta en la fecha límite.
function goalMonthly(g) {
  const left = Number(g.target) - Number(g.saved);
  if (left <= 0 || !g.deadline) return 0;
  return left / Math.max(1, monthsBetween(monthOf(today()), monthOf(g.deadline)));
}

function viewGoalEditor(id) {
  const isNew = id === 'nuevo';
  const g = isNew ? { name: '', target: '', saved: 0, deadline: '' } : T.goals.find((x) => x.id === id);
  if (!g) return '<p class="empty">Este objetivo ya no existe.</p>';
  const money = (v) => (v === '' ? '' : Number(v).toFixed(2).replace('.', ','));
  return `<div class="page-head"><a class="icon-btn" href="#/presupuesto" aria-label="Volver">${icon('back')}</a>
    <h1>${isNew ? 'Nuevo objetivo' : 'Objetivo de ahorro'}</h1>
    ${isNew ? '' : `<button class="icon-btn danger" data-action="delete-goal" aria-label="Borrar">${icon('trash')}</button>`}</div>
    <form id="goal-form" class="form" data-id="${isNew ? '' : g.id}">
      <label class="field"><span>¿Para qué ahorráis?</span><input name="name" required value="${esc(g.name)}" placeholder="Ej.: Vacaciones, colchón de emergencia" maxlength="80"></label>
      <label class="field"><span>Meta (€)</span><input name="target" inputmode="decimal" required value="${money(g.target)}" class="big-input"></label>
      <label class="field"><span>Ya ahorrado (€)</span><input name="saved" inputmode="decimal" value="${money(g.saved)}"></label>
      <label class="field"><span>Fecha límite (opcional)</span><input name="deadline" type="date" value="${g.deadline || ''}"></label>
      <button class="btn primary wide">${isNew ? 'Guardar' : 'Guardar cambios'}</button>
    </form>`;
}

// ---------- Añadir e importar ----------
function importCard() {
  return `<section class="drop" id="drop">
    <div class="drop-ic">${icon('upload')}</div>
    <strong>Arrastra aquí tus archivos</strong>
    <span class="muted">Extracto del banco (Excel, CSV o PDF), facturas en PDF o fotos de tickets</span>
    <div class="btn-row">
      <label class="btn primary file-btn">${icon('file')} Elegir archivos
        <input type="file" id="file-in" multiple accept=".csv,.txt,.tsv,.xlsx,.xls,.ods,.pdf,image/*"></label>
      <label class="btn file-btn">${icon('camera')} Foto de un ticket
        <input type="file" id="cam-in" accept="image/*" capture="environment"></label>
    </div>
    <p id="import-status" role="status"></p>
  </section>`;
}

function viewImport() {
  return `<div class="page-head"><h1>Añadir</h1></div>
    <div class="quick">
      <a class="btn" href="#/mov/nuevo">${icon('edit')} Gasto o ingreso a mano</a>
      <a class="btn" href="#/fijo/nuevo">${icon('plus')} Gasto fijo</a>
    </div>
    ${importCard()}
    <div class="card stack">
      <h2>¿Qué archivo subo?</h2>
      <ul class="prose steps">
        <li><strong>Extracto del banco</strong>: en la web o app de tu banco busca <em>Movimientos > Descargar / Exportar</em> y elige Excel o CSV. También vale el PDF.</li>
        <li><strong>Ticket o factura</strong>: haz una foto o sube el PDF. Se lee la fecha, la tienda y el total.</li>
        <li>Antes de guardar verás todo lo que se ha leído y podrás corregirlo. Los movimientos repetidos se detectan solos y los recibos fijos se marcan como pagados.</li>
      </ul>
    </div>`;
}

function viewReview() {
  if (!review) { location.hash = '#/importar'; return ''; }
  const sel = review.rows.filter((r) => r.keep).length;
  return `<div class="page-head"><a class="icon-btn" href="#/importar" aria-label="Volver">${icon('back')}</a>
    <h1>Revisar</h1><span class="count">${review.rows.length} leídos</span></div>
    <p class="prose">De <strong>${esc(review.files.join(', '))}</strong>. Comprueba las categorías: si cambias una, la app lo recordará para la próxima vez.</p>
    <div class="field"><span>¿De quién son estos movimientos?</span>${whoPicker('review-who', review.who)}</div>
    ${review.rows.some((r) => r.dup) ? '<p class="note">Los marcados como <em>ya está</em> ya existían y no se añadirán salvo que los marques.</p>' : ''}
    <ul class="list review">${review.rows.map((r, i) => `<li class="rv${r.keep ? '' : ' off'}">
      <input type="checkbox" data-keep="${i}" ${r.keep ? 'checked' : ''} aria-label="Añadir">
      <div class="rv-main">
        <strong>${esc(r.concept)}</strong>
        <span>${fmtShort(r.date)}${r.dup ? ' · <em>ya está</em>' : ''}${r.fixed ? ` · <em>pago de ${esc(r.fixed)}</em>` : ''}</span>
        <select data-cat="${i}" aria-label="Categoría">${catOptions(r.category)}</select>
      </div>
      <span class="amt ${r.amount >= 0 ? 'pos' : ''}">${r.amount >= 0 ? '+' : ''}${eur(r.amount)}</span>
    </li>`).join('')}</ul>
    <div class="sticky-actions"><button class="btn primary wide" data-action="save-review" ${sel ? '' : 'disabled'}>Añadir ${sel} movimiento${sel === 1 ? '' : 's'}</button></div>`;
}

function viewEditor(id) {
  const isNew = id === 'nuevo' || id === 'ticket';
  const draft = id === 'ticket' && receipt ? receipt.draft : {};
  const m = isNew ? { date: draft.date || today(), concept: draft.concept || '', amount: draft.amount ?? '', category: '', note: '', who: 'comun' }
    : movs.find((x) => x.id === id);
  if (!m) return '<p class="empty">Este movimiento ya no existe.</p>';
  const kind = m.amount === '' ? 'gasto' : m.amount >= 0 ? 'ingreso' : 'gasto';
  const cat = m.category || (m.concept ? categorize(m.concept, Number(m.amount) || -1, T.rules) : (kind === 'gasto' ? 'otros' : 'nomina'));
  const fixed = m.fixedId && T.fixed.find((f) => f.id === m.fixedId);
  return `<div class="page-head"><a class="icon-btn" href="${isNew ? '#/importar' : '#/movimientos'}" aria-label="Volver">${icon('back')}</a>
    <h1>${id === 'ticket' ? 'Ticket leído' : isNew ? 'Nuevo movimiento' : 'Movimiento'}</h1>
    ${isNew ? '' : `<button class="icon-btn danger" data-action="delete" aria-label="Borrar">${icon('trash')}</button>`}</div>
    ${id === 'ticket' ? '<p class="note">Se han rellenado los campos con lo que se ha leído. Revisa que el total sea correcto.</p>' : ''}
    ${fixed ? `<p class="note">Es el pago de un gasto fijo: <a href="#/fijo/${fixed.id}">${esc(fixed.name)}</a>.</p>` : ''}
    <form id="mov-form" class="form" data-id="${isNew ? '' : m.id}">
      <div class="seg" role="radiogroup">
        <label><input type="radio" name="kind" value="gasto" ${kind === 'gasto' ? 'checked' : ''}><span>Gasto</span></label>
        <label><input type="radio" name="kind" value="ingreso" ${kind === 'ingreso' ? 'checked' : ''}><span>Ingreso</span></label>
      </div>
      <label class="field"><span>Importe (€)</span>
        <input name="amount" inputmode="decimal" required value="${m.amount === '' ? '' : Math.abs(m.amount).toFixed(2).replace('.', ',')}" placeholder="0,00" class="big-input"></label>
      <label class="field"><span>Concepto</span><input name="concept" value="${esc(m.concept)}" placeholder="Ej.: Mercadona" maxlength="120"></label>
      <label class="field"><span>Categoría</span><select name="category" data-auto="${m.category ? '' : '1'}">${catOptions(cat)}</select></label>
      <div class="field"><span>¿De quién?</span>${whoPicker('who', m.who || 'comun')}</div>
      <label class="field"><span>Fecha</span><input type="date" name="date" value="${m.date}" required></label>
      <label class="field"><span>Nota</span><input name="note" value="${esc(m.note)}" placeholder="Opcional"></label>
      ${!isNew && (m.hasFile || m.driveUrl) ? `<button type="button" class="btn" data-action="open-file">${icon('receipt')} Ver ticket</button>` : ''}
      ${!isNew && m.addedBy ? `<p class="prose">Apuntado por ${esc(whoName(m.addedBy))}.</p>` : ''}
      <button class="btn primary wide">${isNew ? 'Guardar' : 'Guardar cambios'}</button>
    </form>
    ${id === 'ticket' && receipt?.text ? `<details class="card"><summary>Ver el texto leído</summary><pre>${esc(receipt.text)}</pre></details>` : ''}`;
}

// ---------- Movimientos ----------
function viewList(params) {
  const cat = params.get('cat') || '';
  let list = inMonth(month);
  if (cat) list = list.filter((m) => m.category === cat);
  if (filter !== 'all') list = list.filter((m) => groupOf(m) === filter);
  if (query) {
    const q = query.toLowerCase();
    list = list.filter((m) => `${m.concept} ${m.note} ${catById(m.category).name}`.toLowerCase().includes(q));
  }
  list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const days = new Map();
  for (const m of list) {
    if (!days.has(m.date)) days.set(m.date, []);
    days.get(m.date).push(m);
  }
  const t = totals(list);
  return `<div class="page-head"><h1>Movimientos</h1><a class="icon-btn" href="#/mov/nuevo" aria-label="Apuntar a mano">${icon('plus')}</a></div>
    ${monthPicker()}
    <label class="search">${icon('search')}<input id="q" type="search" placeholder="Buscar" value="${esc(query)}"></label>
    <div class="chips">
      ${[['all', 'Todos'], ['fijo', 'Fijos'], ['variable', 'Variables'], ['ingreso', 'Ingresos'], ['ahorro', 'Ahorro']].map(([k, l]) =>
        `<button data-filter="${k}" aria-pressed="${filter === k}">${l}</button>`).join('')}
      ${cat ? `<a class="chip-on" href="#/movimientos">${catById(cat).emoji} ${esc(catById(cat).name)} ✕</a>` : ''}
    </div>
    ${whoChips()}
    <p class="sum">${list.length} movimientos · <span class="pos">+${eur(t.income, 0)}</span> · <span>−${eur(t.expense + t.ahorro, 0)}</span></p>
    ${[...days.entries()].map(([d, ms]) => `<h3 class="day">${fmtDay(d)}</h3><ul class="list">${ms.map(movRow).join('')}</ul>`).join('')
      || '<p class="empty">No hay movimientos.</p>'}`;
}

// ---------- Ajustes ----------
function viewMore() {
  const cfg = getConfig();
  const n = names();
  const mine = me();
  return `<div class="page-head"><a class="icon-btn" href="#/inicio" aria-label="Volver">${icon('back')}</a><h1>Ajustes</h1></div>
    <div class="card stack">
      <h2>Estilo</h2>
      <div class="seg full" role="radiogroup" aria-label="Estilo">
        ${[['dark', '🌙 Oscuro'], ['light', '☀️ Claro']].map(([v, l]) =>
          `<label><input type="radio" name="theme" value="${v}" ${theme() === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
      </div>
    </div>
    <form id="couple-form" class="card stack" autocomplete="off">
      <h2>Pareja</h2>
      <p class="prose">Los dos podéis usar la app a la vez, cada uno en su móvil y con la misma clave de Google. Por defecto todo es <strong>de los dos</strong>; si un gasto es solo de uno, se elige al apuntarlo.</p>
      <div class="two full">
        <label class="field"><span>Nombre 1</span><input name="p1" value="${esc(n.p1)}" maxlength="20"></label>
        <label class="field"><span>Nombre 2</span><input name="p2" value="${esc(n.p2)}" maxlength="20"></label>
      </div>
      <div class="field full"><span>Este móvil es de</span>
        <div class="seg seg3" role="radiogroup">
          ${[['', 'Sin indicar'], ['p1', n.p1], ['p2', n.p2]].map(([v, l]) =>
            `<label><input type="radio" name="me" value="${v}" ${mine === v ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}
        </div>
        <small class="muted">Sirve para saber quién apuntó cada cosa.</small></div>
      <button class="btn primary">Guardar</button>
    </form>
    <div class="card stack">
      <h2>Google Sheets y Drive</h2>
      <p class="prose">Todo se guarda en vuestra hoja de cálculo (movimientos, gastos fijos, presupuesto, objetivos) y las fotos y PDF de los tickets en una carpeta de Drive.</p>
      <form id="sync-form" class="form full" autocomplete="off">
        ${DEFAULT_URL ? '' : `<label class="field"><span>URL de la aplicación web</span>
          <input name="url" type="url" required placeholder="https://script.google.com/macros/s/…/exec" value="${esc(cfg.url || '')}"></label>`}
        <label class="field"><span>Clave (la propiedad TOKEN del script)</span>
          <input name="token" type="password" required value="${esc(cfg.token || '')}"></label>
        <div class="btn-row">
          <button class="btn primary">${icon('cloud')} Guardar y sincronizar</button>
          ${isConfigured() ? `<button type="button" class="btn" data-action="sync-now">Sincronizar ahora</button>
            <button type="button" class="btn danger" data-action="sync-off">Desconectar</button>` : ''}
        </div>
      </form>
      <p class="prose" id="sync-status"></p>
    </div>
    <div class="card stack">
      <h2>Copia de seguridad</h2>
      <p class="prose">${isConfigured() ? 'Vuestros datos ya están en Google; esta copia es un respaldo extra en un archivo.'
        : 'Todo se guarda solo en este dispositivo. Haz una copia de vez en cuando o para pasarla a otro móvil.'}</p>
      <div class="btn-row">
        <button class="btn" data-action="export">Descargar copia</button>
        <label class="btn file-btn">Restaurar copia<input type="file" id="restore-in" accept=".json,application/json"></label>
        <button class="btn" data-action="csv">Exportar a Excel (CSV)</button>
      </div>
    </div>
    <div class="card stack">
      <h2>Lo que la app ha aprendido</h2>
      ${T.rules.length ? `<ul class="list">${T.rules.map((r, i) => `<li class="row"><span class="row-main"><strong>${esc(r.key)}</strong>
        <span>${catById(r.category).emoji} ${esc(catById(r.category).name)}</span></span>
        <button class="icon-btn" data-forget="${i}" aria-label="Olvidar">${icon('trash')}</button></li>`).join('')}</ul>`
        : '<p class="prose">Cuando cambies la categoría de un movimiento, la app la recordará para los siguientes que se parezcan.</p>'}
    </div>
    <div class="card stack">
      <h2>Datos</h2>
      <p class="prose">${movs.length} movimientos y ${activeFixed().length} gastos fijos guardados. Versión ${APP_VERSION} de la app.</p>
      <div class="btn-row">
        ${isConfigured() ? '' : '<button class="btn" data-action="demo">Cargar datos de ejemplo</button>'}
        <button class="btn danger" data-action="wipe">Borrar todo</button>
      </div>
    </div>`;
}

// ---------- Archivos de tickets ----------
const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

// Reduce las fotos grandes del móvil para que ocupen poco y suban antes a Drive.
async function shrinkImage(file, max = 1800, quality = 0.82) {
  if (!file.type.startsWith('image/') || file.size < 600e3) return file;
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', quality));
  } catch {
    return file;
  } finally {
    bmp?.close();
  }
}

// Guarda la foto o el PDF del ticket junto al movimiento; se sube a Drive al sincronizar.
async function attachFile(m, file) {
  if (!file) return;
  const blob = await shrinkImage(file);
  await db.put('blobs', blob, m.id);
  Object.assign(m, { hasFile: true, mime: (blob.type || file.type || 'application/octet-stream').split(';')[0] });
}

async function openFile(id) {
  const m = movs.find((x) => x.id === id);
  if (!m) return;
  // Se abre la ventana ya, dentro del clic, para que el navegador no la bloquee.
  const win = window.open('', '_blank');
  const blob = await db.get('blobs', id);
  if (blob) {
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url; else location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } else if (m.driveUrl) {
    if (win) win.location.href = m.driveUrl; else location.href = m.driveUrl;
  } else {
    win?.close();
    toast('El ticket no está en este dispositivo');
  }
}

// ---------- Sincronización con Google Sheets y Drive ----------
let syncTimer = null;
let syncing = false;
let syncAgain = false;

function scheduleSync(delay = 4000) {
  if (!isConfigured()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(), delay);
}

const stripLocal = ({ dirty, remote, hasFile, key, ...rest }) => rest;
const fmtRel = (ts) => {
  const sec = (Date.now() - ts) / 1000;
  if (sec < 60) return 'ahora mismo';
  if (sec < 3600) return `hace ${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `hace ${Math.floor(sec / 3600)} h`;
  return new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
};

async function syncNow({ manual = false } = {}) {
  if (!isConfigured()) return;
  if (syncing) { syncAgain = true; return; }
  if (!navigator.onLine) { if (manual) toast('Sin conexión: se sincronizará más tarde'); return; }
  syncing = true;
  clearTimeout(syncTimer);
  updateSyncStatus('Sincronizando…');
  try {
    // 1. Tickets nuevos → carpeta de Drive
    for (const m of movs) {
      if (!m.hasFile || m.driveId) continue;
      const blob = await db.get('blobs', m.id);
      if (!blob) continue;
      const ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/webp': 'webp' }[m.mime] || 'jpg';
      const base = `${m.date} ${m.concept || catById(m.category).name}`.replace(/[\\/:*?"<>|]/g, '').slice(0, 60);
      const up = await api('upload', { name: `${base}.${ext}`, mime: m.mime, data: (await blobToDataUrl(blob)).split(',')[1] });
      Object.assign(m, { driveId: up.id, driveUrl: up.url, updatedAt: Date.now(), dirty: true });
      await db.put('movs', m);
    }

    // 2. Cambios → hoja de cálculo
    const lists = () => ({ movs, ...T });
    const sent = Object.fromEntries(Object.entries(lists()).map(([k, l]) => [k, l.filter((r) => r.dirty).map(stripLocal)]));
    const tombs = getTombstones();
    const body = {};
    for (const k of Object.keys(sent)) body[k] = [...sent[k], ...tombs.filter((t) => t.kind === k)];
    const res = await api('sync', body);
    clearTombstones(tombs);

    // Lo enviado queda marcado como guardado, salvo que haya cambiado mientras tanto.
    const done = [];
    for (const [kind, list] of Object.entries(lists())) {
      const version = new Map(sent[kind].map((r) => [r.id, r.updatedAt]));
      for (const r of list) {
        if (r.dirty && version.get(r.id) === r.updatedAt) {
          r.dirty = false;
          r.remote = true;
          if (kind === 'movs') done.push(r);
        }
      }
    }
    await Promise.all(done.map((m) => db.put('movs', m)));

    // 3. Lo que venga de la hoja (otros dispositivos o ediciones a mano)
    let changed = await mergeRemote('movs', res.movs || []);
    for (const k of TABLES) changed = mergeRemote(k, res[k] || []) || changed;
    refreshBudgets();
    await saveTables();

    setConfig({ lastSync: Date.now(), lastError: '' });
    updateSyncStatus();
    if (manual) toast('Sincronizado con Google');
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if (changed && !typing && !/#\/(mov|fijo|objetivo)\/|#\/revisar/.test(location.hash)) render();
  } catch (err) {
    setConfig({ lastError: err.message });
    updateSyncStatus();
    if (manual) toast(err.message);
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(1000); }
  }
}

// Gana la versión más reciente; un cambio local aún sin enviar no se pisa con uno más antiguo.
function mergeRemote(kind, list) {
  let changed = false;
  const writes = [];
  for (const r of list) {
    if (kind === 'rules') r.key = r.id;
    // removeMov cambia la lista de movimientos, así que se vuelve a leer en cada vuelta.
    const arr = kind === 'movs' ? movs : T[kind];
    const local = arr.find((x) => x.id === r.id);
    const localWins = local && local.dirty && local.updatedAt > r.updatedAt;
    if (r.deleted) {
      if (!local || localWins) continue;
      if (kind === 'movs') writes.push(removeMov(r.id, { tombstone: false }));
      else arr.splice(arr.indexOf(local), 1);
      changed = true;
      continue;
    }
    if (local) {
      local.remote = true;
      if (localWins || r.updatedAt <= local.updatedAt) continue;
      if (kind === 'movs') {
        const hadUpload = Boolean(local.driveId);
        if (hadUpload && local.driveId !== r.driveId) writes.push(db.del('blobs', r.id));
        r.hasFile = Boolean(r.driveId) || (local.hasFile && !hadUpload);
      }
      Object.assign(local, r, { dirty: false });
      if (kind === 'movs') writes.push(db.put('movs', local));
    } else {
      const fresh = { ...r, remote: true, dirty: false };
      if (kind === 'movs') {
        fresh.hasFile = Boolean(r.driveId);
        movs.push(fresh);
        writes.push(db.put('movs', fresh));
      } else arr.push(fresh);
    }
    changed = true;
  }
  return kind === 'movs' ? Promise.all(writes).then(() => changed) : changed;
}

function updateSyncStatus(text) {
  const el = $('#sync-status');
  if (!el) return;
  const c = getConfig();
  if (text) el.textContent = text;
  else if (!isConfigured()) el.textContent = 'Sin conectar: todo se guarda solo en este dispositivo.';
  else if (c.lastError) el.textContent = `El último intento falló: ${c.lastError}`;
  else if (c.lastSync) el.textContent = `Última sincronización: ${fmtRel(c.lastSync)}`;
  else el.textContent = 'Conectado, aún sin sincronizar.';
}

// ---------- Router ----------
function render() {
  $('#tip')?.classList.remove('show');
  const [path, qs] = (location.hash.slice(1) || '/inicio').split('?');
  const params = new URLSearchParams(qs);
  const [, view, id] = path.split('/');
  const tab = { inicio: 'inicio', mas: 'inicio', movimientos: 'movimientos', mov: 'movimientos', fijos: 'fijos', fijo: 'fijos',
    presupuesto: 'presupuesto', objetivo: 'presupuesto', importar: 'importar' }[view];
  nav.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  nav.classList.toggle('hidden', ['mov', 'revisar', 'fijo', 'objetivo'].includes(view));
  const views = {
    inicio: viewHome,
    importar: viewImport,
    revisar: viewReview,
    mov: () => viewEditor(id),
    movimientos: () => viewList(params),
    fijos: viewFixed,
    fijo: () => viewFixedEditor(id, params),
    presupuesto: viewBudget,
    objetivo: () => viewGoalEditor(id),
    mas: viewMore,
  };
  app.innerHTML = (views[view] || viewHome)();
  bindTooltips(app);
  updateSyncStatus();
  // Solo vuelve arriba al cambiar de pantalla, no al marcar una casilla o cambiar de mes.
  if (location.hash !== lastRoute) window.scrollTo(0, 0);
  lastRoute = location.hash;
}
let lastRoute = '';

// ---------- Importar archivos ----------
async function handleFiles(files) {
  const status = $('#import-status');
  const say = (msg) => { if (status) status.textContent = msg; };
  const rows = [];
  const names_ = [];
  for (const file of files) {
    try {
      const res = await readFile(file, say);
      if (res.kind === 'receipt') {
        if (files.length === 1) {
          receipt = { ...res, file };
          say('');
          location.hash = '#/mov/ticket';
          return;
        }
        if (res.draft.amount) rows.push({ ...res.draft, source: 'ticket', file });
      } else {
        rows.push(...res.rows.map((r) => ({ ...r, source: 'extracto' })));
      }
      names_.push(file.name);
    } catch (err) {
      say(err.message);
      toast(err.message);
      return;
    }
  }
  if (!rows.length) {
    say('No he encontrado movimientos en el archivo. Prueba con el Excel o CSV que descarga tu banco.');
    return;
  }
  review = {
    files: names_,
    who: 'comun',
    rows: rows.map((r) => {
      const dup = movs.some((m) => sameMov(m, r));
      const f = r.amount < 0 && fixedFor(r);
      return { ...r, category: f ? f.category : categorize(r.concept, r.amount, T.rules), fixed: f ? f.name : '', dup, keep: !dup };
    }).sort((a, b) => b.date.localeCompare(a.date)),
  };
  say('');
  location.hash = '#/revisar';
}

async function saveReview() {
  const keep = review.rows.filter((r) => r.keep);
  const added = keep.map((r) => newMov({ ...r, who: review.who }));
  await Promise.all(keep.map((r, i) => r.file && attachFile(added[i], r.file)));
  await Promise.all(added.map((m) => db.put('movs', m)));
  movs.push(...added);
  scheduleSync(1000);
  month = monthOf(added[0].date);
  review = null;
  toast(`${added.length} movimientos añadidos`);
  location.hash = '#/inicio';
}

// ---------- Datos de ejemplo ----------
async function loadDemo() {
  const base = monthOf(today());
  const start = shiftMonth(base, -5);
  const now = Date.now();
  const fixed = [
    ['Hipoteca', 'casa', 720, 2, 1, 'recibo hipoteca'],
    ['Comunidad', 'comunidad', 65, 3, 1, 'recibo comunidad prop'],
    ['Luz (Endesa)', 'suministros', 70, 5, 1, 'recibo endesa energia'],
    ['Fibra y móviles', 'suministros', 58.9, 6, 1, 'recibo movistar fibra'],
    ['Agua', 'suministros', 34, 8, 2, 'recibo aigues'],
    ['Netflix', 'suscripciones', 13.99, 9, 1, 'netflix'],
    ['Spotify', 'suscripciones', 10.99, 9, 1, 'spotify'],
    ['Seguro del hogar', 'seguros', 32.5, 10, 1, 'seguro mapfre hogar'],
    ['Comedor del colegio', 'educacion', 110, 12, 1, 'colegio comedor'],
    ['Seguro del coche', 'seguros', 420, 15, 12, 'seguro linea directa'],
    ['IBI', 'comunidad', 380, 20, 12, 'recibo ibi'],
  ].map(([name, category, amount, day, every, match], i) => ({
    id: uid(), name, category, amount, day, every, match: conceptKey(match), who: 'comun',
    // El seguro del coche se pagó hace dos meses y el IBI llega dentro de dos.
    start: every === 12 ? shiftMonth(base, i === 9 ? -2 : 2) : start,
    createdAt: now, updatedAt: now, dirty: true,
  }));
  T.fixed.push(...fixed);
  T.goals.push(
    { id: uid(), name: 'Vacaciones de verano', target: 2000, saved: 650, deadline: `${Number(base.slice(0, 4)) + 1}-06-30`, createdAt: now, updatedAt: now, dirty: true },
    { id: uid(), name: 'Colchón para imprevistos', target: 6000, saved: 2400, deadline: '', createdAt: now, updatedAt: now, dirty: true },
  );
  for (const [id, limit] of [['super', 450], ['restaurantes', 120], ['ocio', 150], ['ropa', 100]]) {
    T.budgets = T.budgets.filter((b) => b.id !== id).concat({ id, limit, updatedAt: now, dirty: true });
  }
  refreshBudgets();

  const demo = [];
  const rnd = (a, b) => Math.round((a + Math.random() * (b - a)) * 100) / 100;
  for (let i = 5; i >= 0; i--) {
    const ym = shiftMonth(base, -i);
    const day = (d) => `${ym}-${String(d).padStart(2, '0')}`;
    const limit = i === 0 ? Math.min(28, new Date().getDate()) : 28;
    const add = (d, concept, amount, w = 'comun') =>
      d <= limit && demo.push(newMov({ date: day(d), concept, amount, who: w, source: 'ejemplo' }));
    add(1, 'NOMINA EMPRESA SL', 2150, 'p1');
    add(1, 'NOMINA AYUNTAMIENTO', 1480, 'p2');
    // Recibos fijos (salvo el último, que queda pendiente este mes)
    for (const f of fixed) {
      if (!dueIn(f, ym) || (i === 0 && f.day > 9)) continue;
      const amount = f.match.includes('endesa') ? rnd(55, 95) : f.match.includes('aigues') ? rnd(28, 40) : f.amount;
      add(f.day, `RECIBO ${f.match.toUpperCase()}`, -amount);
    }
    [3, 10, 17, 24].forEach((d) => add(d, 'COMPRA MERCADONA', -rnd(70, 140)));
    [7, 21].forEach((d) => add(d, 'COMPRA LIDL', -rnd(25, 60)));
    [4, 18].forEach((d, k) => add(d, 'REPSOL GASOLINERA', -rnd(45, 70), k ? 'p2' : 'p1'));
    add(14, 'RESTAURANTE LA PLAZA', -rnd(35, 80));
    add(26, 'TELEPIZZA', -rnd(18, 30));
    add(15, 'FARMACIA CENTRAL', -rnd(8, 30));
    add(20, i % 2 ? 'ZARA' : 'AMAZON MARKETPLACE', -rnd(25, 90), i % 2 ? 'p2' : 'p1');
    add(25, 'TRASPASO A AHORRO', -300);
    if (i === 2) add(16, 'BOOKING.COM HOTEL', -340);
    if (i === 4) add(22, 'TALLER ITV Y REVISION', -180, 'p1');
  }
  await Promise.all(demo.map((m) => db.put('movs', m)));
  movs.push(...demo);
  await saveMeta();
  scheduleSync(1000);
  month = base;
  toast('Datos de ejemplo cargados');
  location.hash = '#/inicio';
  render();
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const parseNum = (s) => Number(String(s).replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));

// ---------- Eventos ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-month],[data-filter],[data-who],[data-who-go],[data-action],[data-forget],[data-pay],[data-contribute]');
  if (!t) return;
  if (t.dataset.month) { month = shiftMonth(month, Number(t.dataset.month)); render(); }
  if (t.dataset.filter) { filter = t.dataset.filter; render(); }
  if (t.dataset.who) { who = t.dataset.who; render(); }
  if (t.dataset.whoGo) { e.preventDefault(); who = t.dataset.whoGo; location.hash = '#/movimientos'; }
  if (t.dataset.pay) payFixed(t.dataset.pay);
  if (t.dataset.contribute) {
    const g = T.goals.find((x) => x.id === t.dataset.contribute);
    const v = prompt(`¿Cuánto apartáis para "${g.name}"? (€)`, '');
    const n = v && parseNum(v);
    if (n) {
      await upsert('goals', { id: g.id, saved: Math.round((Number(g.saved) + n) * 100) / 100 });
      toast(`+${eur(n, 0)} para ${g.name}`);
      render();
    }
  }
  if (t.dataset.forget) {
    const [r] = T.rules.splice(Number(t.dataset.forget), 1);
    if (r.remote) addTombstone('rules', r.id);
    await saveMeta();
    render();
  }
  const action = t.dataset.action;
  if (action === 'demo') loadDemo();
  if (action === 'save-review') saveReview();
  if (action === 'delete') {
    const id = $('#mov-form').dataset.id;
    if (!confirm('¿Borrar este movimiento?')) return;
    await removeMov(id);
    toast('Movimiento borrado');
    location.hash = '#/movimientos';
  }
  if (action === 'delete-fixed') {
    if (!confirm('¿Borrar este gasto fijo? Los pagos ya apuntados se quedan.')) return;
    await removeRec('fixed', $('#fixed-form').dataset.id);
    toast('Gasto fijo borrado');
    location.hash = '#/fijos';
  }
  if (action === 'delete-goal') {
    if (!confirm('¿Borrar este objetivo?')) return;
    await removeRec('goals', $('#goal-form').dataset.id);
    location.hash = '#/presupuesto';
  }
  if (action === 'open-file') openFile($('#mov-form').dataset.id);
  if (action === 'sync-now') syncNow({ manual: true });
  if (action === 'sync-off') {
    if (!confirm('¿Dejar de sincronizar este dispositivo? Vuestros datos en Google no se borran.')) return;
    setConfig({ token: '', lastSync: 0, lastError: '' });
    render();
  }
  if (action === 'export') {
    const data = { app: 'economia', version: 3, movs: movs.map(stripLocal),
      ...Object.fromEntries(TABLES.map((k) => [k, T[k].map(stripLocal)])) };
    download(`economia-${today()}.json`, JSON.stringify(data, null, 1), 'application/json');
  }
  if (action === 'csv') {
    const rows = [['Fecha', 'Concepto', 'Categoría', 'Tipo', 'Quién', 'Importe', 'Nota']].concat(
      [...movs].sort((a, b) => a.date.localeCompare(b.date))
        .map((m) => [m.date, m.concept, catById(m.category).name, GROUPS[groupOf(m)], whoName(m.who), String(m.amount).replace('.', ','), m.note]));
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    download(`movimientos-${today()}.csv`, '﻿' + csv, 'text/csv');
  }
  if (action === 'wipe') {
    const msg = isConfigured()
      ? 'Se borrarán los datos de este dispositivo. Lo guardado en Google no se toca y volverá en la próxima sincronización. ¿Seguro?'
      : 'Se borrarán todos los movimientos, gastos fijos, presupuestos y objetivos de este dispositivo. ¿Seguro?';
    if (!confirm(msg)) return;
    await Promise.all([db.clear('movs'), db.clear('meta'), db.clear('blobs')]);
    movs = [];
    TABLES.forEach((k) => (T[k] = []));
    budgets = {};
    resetTombstones();
    setConfig({ lastSync: 0 });
    toast('Todo borrado');
    render();
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'file-in' || t.id === 'cam-in') {
    if (t.files.length) handleFiles([...t.files]);
    t.value = '';
  }
  if (t.id === 'restore-in' && t.files[0]) {
    try {
      const data = JSON.parse(await t.files[0].text());
      if (data.app !== 'economia' || !Array.isArray(data.movs)) throw new Error();
      await Promise.all(data.movs.map((m) => db.put('movs', { ...m, dirty: true })));
      for (const k of TABLES) if (data[k]) await db.put('meta', data[k], k);
      await load();
      TABLES.forEach((k) => T[k].forEach((r) => (r.dirty = true)));
      await saveMeta();
      toast(`Copia restaurada: ${data.movs.length} movimientos`);
      render();
    } catch {
      toast('Ese archivo no es una copia de esta app');
    }
    t.value = '';
  }
  if (t.name === 'review-who') review.who = t.value;
  if (t.name === 'theme') applyTheme(t.value);
  if (t.dataset.keep !== undefined) {
    review.rows[Number(t.dataset.keep)].keep = t.checked;
    render();
  }
  if (t.dataset.cat !== undefined) {
    const r = review.rows[Number(t.dataset.cat)];
    r.category = t.value;
    const key = learn(r.concept, t.value);
    // Aplica la misma categoría al resto de filas con un concepto parecido.
    review.rows.forEach((o) => { if (key && conceptKey(o.concept) === key) o.category = t.value; });
    render();
    toast('Lo recordaré para la próxima vez');
  }
});

document.addEventListener('input', (e) => {
  // Movimiento nuevo: la categoría se elige sola mientras se escribe el concepto, hasta que se toque a mano.
  const form = e.target.form;
  if (form?.id === 'mov-form' && e.target.name === 'concept' && form.category.dataset.auto) {
    const sign = form.kind.value === 'ingreso' ? 1 : -1;
    form.category.value = categorize(e.target.value, sign, T.rules);
  }
  if (e.target.name === 'category' && e.target.form?.id === 'mov-form') e.target.dataset.auto = '';
  if (e.target.id === 'q') {
    query = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const q = $('#q');
    q.focus();
    q.setSelectionRange(pos, pos);
  }
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'mov-form') {
    const data = Object.fromEntries(new FormData(f));
    const value = Math.abs(parseNum(data.amount));
    if (!value) { toast('Escribe un importe'); return; }
    const amount = data.kind === 'gasto' ? -value : value;
    const old = movs.find((m) => m.id === f.dataset.id);
    if (old) {
      const autoCat = categorize(data.concept, amount, T.rules);
      Object.assign(old, { date: data.date, concept: data.concept.trim(), amount, category: data.category, who: data.who, note: data.note });
      await saveMov(old);
      if (data.category !== autoCat && !old.fixedId && learn(data.concept, data.category)) toast('Guardado. Lo recordaré para la próxima vez');
      else toast('Guardado');
    } else {
      const fromTicket = receipt && location.hash.endsWith('ticket');
      const m = newMov({ ...data, amount, source: fromTicket ? 'ticket' : 'manual' });
      if (data.category !== categorize(data.concept, amount, T.rules)) learn(data.concept, data.category);
      m.category = data.category;
      if (fromTicket) await attachFile(m, receipt.file);
      await db.put('movs', m);
      scheduleSync(1000);
      movs.push(m);
      receipt = null;
      month = monthOf(m.date);
      toast('Movimiento guardado');
    }
    location.hash = '#/inicio';
  }
  if (f.id === 'fixed-form') {
    const data = Object.fromEntries(new FormData(f));
    const amount = Math.abs(parseNum(data.amount));
    if (!amount) { toast('Escribe un importe'); return; }
    const rec = {
      id: f.dataset.id || uid(), name: data.name.trim(), amount, category: data.category,
      day: Math.min(31, Math.max(1, Number(data.day) || 1)), every: Number(data.every) || 1,
      start: data.start || month, who: data.who || 'comun', match: conceptKey(data.match || ''),
    };
    await upsert('fixed', rec);
    // Enlaza los pagos que ya estaban apuntados con ese concepto.
    if (rec.match) {
      for (const m of movs) {
        if (!m.fixedId && m.amount < 0 && conceptKey(m.concept) === rec.match) {
          m.fixedId = rec.id;
          await saveMov(m);
        }
      }
    }
    toast('Gasto fijo guardado');
    location.hash = '#/fijos';
  }
  if (f.id === 'goal-form') {
    const data = Object.fromEntries(new FormData(f));
    const target = Math.abs(parseNum(data.target));
    if (!target) { toast('Escribe la meta'); return; }
    await upsert('goals', { id: f.dataset.id || uid(), name: data.name.trim(), target,
      saved: Math.abs(parseNum(data.saved || 0)) || 0, deadline: data.deadline || '' });
    toast('Objetivo guardado');
    location.hash = '#/presupuesto';
  }
  if (f.id === 'couple-form') {
    const data = Object.fromEntries(new FormData(f));
    const n = names();
    for (const id of ['p1', 'p2']) {
      const value = (data[id] || '').trim() || (id === 'p1' ? 'Persona 1' : 'Persona 2');
      if (value !== n[id]) await upsert('settings', { id, value });
    }
    store.set('economia.me', data.me || '');
    toast('Guardado');
    render();
  }
  if (f.id === 'sync-form') {
    // Con la URL integrada en sync.js solo hace falta la clave.
    const url = DEFAULT_URL || f.url.value.trim();
    const token = f.token.value.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { toast('La URL debe ser la de tu script de Google (…/exec)'); return; }
    const first = !getConfig().token;
    setConfig({ url, token, lastError: '' });
    // Primera vez: hay que subir todo lo que ya existe en este dispositivo.
    if (first) [movs, ...TABLES.map((k) => T[k])].forEach((l) => l.forEach((r) => (r.dirty = true)));
    await syncNow({ manual: true });
    if (location.hash === '#/mas') render();
  }
  if (f.id === 'budget-form') {
    for (const [k, v] of new FormData(f)) {
      const n = v.trim() && parseNum(v) > 0 ? parseNum(v) : 0;
      const rec = T.budgets.find((r) => r.id === k);
      if ((rec?.limit || 0) === n) continue;
      if (rec) Object.assign(rec, { limit: n, updatedAt: Date.now(), dirty: true });
      else T.budgets.push({ id: k, limit: n, updatedAt: Date.now(), dirty: true });
    }
    refreshBudgets();
    await saveMeta();
    toast('Presupuesto guardado');
    render();
  }
});

// Arrastrar y soltar archivos en cualquier parte de la pantalla.
document.addEventListener('dragover', (e) => { e.preventDefault(); $('#drop')?.classList.add('over'); });
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('#drop')?.classList.remove('over'); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  $('#drop')?.classList.remove('over');
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  if (!$('#drop')) location.hash = '#/importar';
  setTimeout(() => handleFiles(files), 0);
});

window.addEventListener('hashchange', render);
window.addEventListener('online', () => scheduleSync(500));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) syncNow();
  else scheduleSync(500);
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // Cuando se instala una versión nueva de la app, se recarga una vez para usarla ya.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
}

await load();
render();
scheduleSync(1000);
