import { db } from './db.js';
import { CATEGORIES, catById, categorize, conceptKey } from './categories.js';
import { readFile } from './importer.js';
import { monthlyBars, categoryBars, budgetMeter, bindTooltips, eur } from './charts.js';

const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const nav = $('#nav');

const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

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
  repeat: '<path d="M4 9a7 7 0 0 1 12-3l2 2M20 15a7 7 0 0 1-12 3l-2-2"/><path d="M18 4v4h-4M6 20v-4h4"/>',
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
const monthName = (ym, opts = { month: 'long', year: 'numeric' }) =>
  new Date(`${ym}-01T00:00`).toLocaleDateString('es-ES', opts);
const fmtDay = (s) => new Date(s + 'T00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = (s) => new Date(s + 'T00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

// ---------- Estado ----------
let movs = [];
let budgets = {}; // { categoria: límite mensual }
let rules = []; // [{ key, category }] aprendidas al corregir categorías
let month = monthOf(today());
let query = '';
let filter = 'all';
let review = null; // movimientos leídos de un archivo, pendientes de confirmar
let receipt = null; // ticket leído, pendiente de confirmar

async function load() {
  [movs, budgets, rules] = await Promise.all([db.all('movs'), db.get('meta', 'budgets'), db.get('meta', 'rules')]);
  budgets ||= {};
  rules ||= [];
  // Si este mes no hay nada, empieza por el último mes con movimientos.
  if (movs.length && !movs.some((m) => monthOf(m.date) === month)) {
    month = monthOf(movs.reduce((a, b) => (a.date > b.date ? a : b)).date);
  }
}

const saveMov = (m) => {
  m.updatedAt = Date.now();
  return db.put('movs', m);
};
const saveMeta = () => Promise.all([db.put('meta', budgets, 'budgets'), db.put('meta', rules, 'rules')]);

function newMov(fields) {
  const amount = Number(fields.amount) || 0;
  return {
    id: uid(),
    date: fields.date || today(),
    concept: fields.concept || '',
    amount,
    category: fields.category || categorize(fields.concept || '', amount, rules),
    note: fields.note || '',
    source: fields.source || 'manual',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Recuerda la categoría elegida para los próximos movimientos con un concepto parecido.
function learn(concept, category) {
  const key = conceptKey(concept);
  if (!key) return false;
  rules = [...rules.filter((r) => r.key !== key), { key, category }];
  saveMeta();
  return key;
}

const sameMov = (a, b) => a.date === b.date && Math.abs(a.amount - b.amount) < 0.005 &&
  conceptKey(a.concept) === conceptKey(b.concept);

// ---------- Cálculos ----------
const inMonth = (ym) => movs.filter((m) => monthOf(m.date) === ym);
function totals(list) {
  let income = 0, expense = 0;
  for (const m of list) {
    if (catById(m.category).kind === 'ingreso') income += m.amount;
    else expense -= m.amount; // las devoluciones (positivas) restan gasto
  }
  return { income, expense, saving: income - expense };
}
function byCategory(list) {
  const map = new Map();
  for (const m of list) {
    const c = catById(m.category);
    if (c.kind !== 'gasto') continue;
    map.set(c.id, (map.get(c.id) || 0) - m.amount);
  }
  return [...map.entries()]
    .map(([id, value]) => ({ ...catById(id), value }))
    .filter((r) => r.value > 0.005)
    .sort((a, b) => b.value - a.value);
}
// Recibos que se repiten una vez al mes en al menos 3 de los últimos 4 meses (luz, seguros, suscripciones...).
const FIXED_CATS = ['casa', 'suministros', 'suscripciones', 'seguros', 'educacion', 'impuestos'];
function recurring() {
  const months = [0, 1, 2, 3].map((i) => shiftMonth(month, -i));
  const seen = new Map();
  for (const m of movs) {
    if (m.amount >= 0 || !months.includes(monthOf(m.date))) continue;
    const key = conceptKey(m.concept);
    if (!key) continue;
    const e = seen.get(key) || { key, count: 0, amounts: [], months: new Set(), last: m };
    e.count++;
    e.amounts.push(-m.amount);
    e.months.add(monthOf(m.date));
    if (m.date >= e.last.date) e.last = m;
    seen.set(key, e);
  }
  return [...seen.values()]
    .filter((e) => e.months.size >= 3 && e.count <= e.months.size + 1)
    .filter((e) => FIXED_CATS.includes(e.last.category) || Math.max(...e.amounts) <= Math.min(...e.amounts) * 1.1)
    .sort((a, b) => a.last.amount - b.last.amount);
}

// ---------- Aviso y diálogo ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- Vistas ----------
const catOptions = (selected, amount) => {
  const groups = [['gasto', 'Gastos'], ['ingreso', 'Ingresos']];
  return groups.map(([kind, label]) => `<optgroup label="${label}">${CATEGORIES.filter((c) => c.kind === kind)
    .map((c) => `<option value="${c.id}"${c.id === selected ? ' selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
};

function movRow(m) {
  const c = catById(m.category);
  return `<li><a class="row" href="#/mov/${m.id}">
    <span class="cat-ic">${c.emoji}</span>
    <span class="row-main"><strong>${esc(m.concept || c.name)}</strong><span>${esc(c.name)} · ${fmtShort(m.date)}</span></span>
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

function viewHome() {
  if (!movs.length) {
    return `<section class="hero"><h1>Economía familiar</h1>
      <p class="muted">Sube el extracto de tu banco o una foto de un ticket y la app rellenará todo sola.</p></section>
      ${importCard()}
      <div class="card stack">
        <h2>¿Quieres verla con datos?</h2>
        <p class="prose">Carga unos meses de ejemplo para ver cómo quedan los gráficos. Luego puedes borrarlos desde <em>Más</em>.</p>
        <button class="btn" data-action="demo">Cargar datos de ejemplo</button>
      </div>`;
  }
  const list = inMonth(month);
  const t = totals(list);
  const cats = byCategory(list);
  const series = [-5, -4, -3, -2, -1, 0].map((i) => {
    const ym = shiftMonth(month, i);
    return { key: ym, label: monthName(ym, { month: 'short' }).replace('.', ''), title: monthName(ym), ...totals(inMonth(ym)) };
  });
  const rate = t.income > 0 ? Math.round((t.saving / t.income) * 100) : null;
  const budgetRows = cats.filter((c) => budgets[c.id]).concat(
    Object.keys(budgets).filter((id) => budgets[id] && !cats.some((c) => c.id === id)).map((id) => ({ ...catById(id), value: 0 })));
  const fixed = recurring();
  return `${monthPicker()}
    <section class="tiles">
      <div class="tile main"><span>Te queda este mes</span><strong class="${t.saving < 0 ? 'neg' : ''}">${eur(t.saving)}</strong>
        <small>${rate === null ? 'Sin ingresos registrados' : t.saving >= 0 ? `Ahorras el ${rate} % de lo que entra` : 'Gastas más de lo que entra'}</small></div>
      <div class="tile"><span>Entra</span><strong>${eur(t.income, 0)}</strong></div>
      <div class="tile"><span>Sale</span><strong>${eur(t.expense, 0)}</strong></div>
    </section>

    <section class="card"><h2>Últimos 6 meses</h2>${monthlyBars(series, month)}</section>

    <section class="card"><div class="section-head"><h2>¿En qué se va el dinero?</h2><span class="count">${eur(t.expense, 0)}</span></div>
      ${categoryBars(cats, t.expense)}</section>

    ${budgetRows.length ? `<section class="card"><div class="section-head"><h2>Presupuestos</h2><a class="link" href="#/presupuestos">Editar</a></div>
      ${budgetRows.map((c) => `<div class="budget"><span class="hb-label">${c.emoji} ${esc(c.name)}</span>${budgetMeter(c.value, budgets[c.id])}</div>`).join('')}
    </section>` : `<a class="card hint" href="#/presupuestos">${icon('plus')}<span><strong>Pon un presupuesto</strong><br>
      <span class="muted">Decide cuánto quieres gastar al mes en cada cosa y la app te avisa.</span></span></a>`}

    ${fixed.length ? `<section class="card"><div class="section-head"><h2>Gastos fijos</h2>
      <span class="count">${eur(fixed.reduce((s, f) => s - f.last.amount, 0), 0)}/mes</span></div>
      <p class="prose">Se repiten cada mes. Revísalos de vez en cuando: aquí suele haber ahorro fácil.</p>
      <ul class="list">${fixed.map((f) => movRow(f.last)).join('')}</ul></section>` : ''}

    <section class="card"><div class="section-head"><h2>Últimos movimientos</h2><a class="link" href="#/movimientos">Ver todos</a></div>
      <ul class="list">${list.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map(movRow).join('') || '<li class="empty">Nada este mes.</li>'}</ul>
    </section>`;
}

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
    ${importCard()}
    <div class="card stack">
      <h2>¿Qué archivo subo?</h2>
      <ul class="prose steps">
        <li><strong>Extracto del banco</strong>: en la web o app de tu banco busca <em>Movimientos > Descargar / Exportar</em> y elige Excel o CSV. También vale el PDF.</li>
        <li><strong>Ticket o factura</strong>: haz una foto o sube el PDF. Se lee la fecha, la tienda y el total.</li>
        <li>Antes de guardar verás todo lo que se ha leído y podrás corregirlo. Los movimientos repetidos se detectan solos.</li>
      </ul>
      <a class="btn" href="#/mov/nuevo">${icon('edit')} Apuntar a mano</a>
    </div>`;
}

function viewReview() {
  if (!review) { location.hash = '#/importar'; return ''; }
  const sel = review.rows.filter((r) => r.keep).length;
  return `<div class="page-head"><a class="icon-btn" href="#/importar" aria-label="Volver">${icon('back')}</a>
    <h1>Revisar</h1><span class="count">${review.rows.length} leídos</span></div>
    <p class="prose">De <strong>${esc(review.files.join(', '))}</strong>. Comprueba las categorías: si cambias una, la app lo recordará para la próxima vez.</p>
    ${review.rows.some((r) => r.dup) ? '<p class="note">Los marcados como <em>ya está</em> ya existían y no se añadirán salvo que los marques.</p>' : ''}
    <ul class="list review">${review.rows.map((r, i) => `<li class="rv${r.keep ? '' : ' off'}">
      <input type="checkbox" data-keep="${i}" ${r.keep ? 'checked' : ''} aria-label="Añadir">
      <div class="rv-main">
        <strong>${esc(r.concept)}</strong>
        <span>${fmtShort(r.date)}${r.dup ? ' · <em>ya está</em>' : ''}</span>
        <select data-cat="${i}" aria-label="Categoría">${catOptions(r.category, r.amount)}</select>
      </div>
      <span class="amt ${r.amount >= 0 ? 'pos' : ''}">${r.amount >= 0 ? '+' : ''}${eur(r.amount)}</span>
    </li>`).join('')}</ul>
    <div class="sticky-actions"><button class="btn primary wide" data-action="save-review" ${sel ? '' : 'disabled'}>Añadir ${sel} movimiento${sel === 1 ? '' : 's'}</button></div>`;
}

function viewEditor(id) {
  const isNew = id === 'nuevo' || id === 'ticket';
  const draft = id === 'ticket' && receipt ? receipt.draft : {};
  const m = isNew ? { date: draft.date || today(), concept: draft.concept || '', amount: draft.amount ?? '', category: '', note: '' }
    : movs.find((x) => x.id === id);
  if (!m) return '<p class="empty">Este movimiento ya no existe.</p>';
  const kind = m.amount === '' ? 'gasto' : m.amount >= 0 ? 'ingreso' : 'gasto';
  const cat = m.category || (m.concept ? categorize(m.concept, Number(m.amount) || -1, rules) : (kind === 'gasto' ? 'otros' : 'nomina'));
  return `<div class="page-head"><a class="icon-btn" href="${isNew ? '#/importar' : '#/movimientos'}" aria-label="Volver">${icon('back')}</a>
    <h1>${id === 'ticket' ? 'Ticket leído' : isNew ? 'Nuevo movimiento' : 'Movimiento'}</h1>
    ${isNew ? '' : `<button class="icon-btn danger" data-action="delete" aria-label="Borrar">${icon('trash')}</button>`}</div>
    ${id === 'ticket' ? '<p class="note">Se han rellenado los campos con lo que se ha leído. Revisa que el total sea correcto.</p>' : ''}
    <form id="mov-form" class="form" data-id="${isNew ? '' : m.id}">
      <div class="seg" role="radiogroup">
        <label><input type="radio" name="kind" value="gasto" ${kind === 'gasto' ? 'checked' : ''}><span>Gasto</span></label>
        <label><input type="radio" name="kind" value="ingreso" ${kind === 'ingreso' ? 'checked' : ''}><span>Ingreso</span></label>
      </div>
      <label class="field"><span>Importe (€)</span>
        <input name="amount" inputmode="decimal" required value="${m.amount === '' ? '' : Math.abs(m.amount).toFixed(2).replace('.', ',')}" placeholder="0,00" class="big-input"></label>
      <label class="field"><span>Concepto</span><input name="concept" value="${esc(m.concept)}" placeholder="Ej.: Mercadona" maxlength="120"></label>
      <label class="field"><span>Categoría</span><select name="category">${catOptions(cat)}</select></label>
      <label class="field"><span>Fecha</span><input type="date" name="date" value="${m.date}" required></label>
      <label class="field"><span>Nota</span><input name="note" value="${esc(m.note)}" placeholder="Opcional"></label>
      <button class="btn primary wide">${isNew ? 'Guardar' : 'Guardar cambios'}</button>
    </form>
    ${id === 'ticket' && receipt?.text ? `<details class="card"><summary>Ver el texto leído</summary><pre>${esc(receipt.text)}</pre></details>` : ''}`;
}

function viewList(params) {
  const cat = params.get('cat') || '';
  let list = inMonth(month);
  if (cat) list = list.filter((m) => m.category === cat);
  if (filter === 'gasto') list = list.filter((m) => catById(m.category).kind === 'gasto');
  if (filter === 'ingreso') list = list.filter((m) => catById(m.category).kind === 'ingreso');
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
      ${[['all', 'Todos'], ['gasto', 'Gastos'], ['ingreso', 'Ingresos']].map(([k, l]) =>
        `<button data-filter="${k}" aria-pressed="${filter === k}">${l}</button>`).join('')}
      ${cat ? `<a class="chip-on" href="#/movimientos">${catById(cat).emoji} ${esc(catById(cat).name)} ✕</a>` : ''}
    </div>
    <p class="sum">${list.length} movimientos · <span class="pos">+${eur(t.income, 0)}</span> · <span>−${eur(t.expense, 0)}</span></p>
    ${[...days.entries()].map(([d, ms]) => `<h3 class="day">${fmtDay(d)}</h3><ul class="list">${ms.map(movRow).join('')}</ul>`).join('')
      || '<p class="empty">No hay movimientos.</p>'}`;
}

function viewBudgets() {
  const spent = new Map(byCategory(inMonth(month)).map((c) => [c.id, c.value]));
  const avg = new Map();
  for (let i = 1; i <= 3; i++) for (const c of byCategory(inMonth(shiftMonth(month, -i)))) avg.set(c.id, (avg.get(c.id) || 0) + c.value / 3);
  return `<div class="page-head"><h1>Presupuestos</h1></div>
    ${monthPicker()}
    <p class="prose">Escribe cuánto quieres gastar como máximo al mes. Debajo verás lo que llevas gastado y la media de los 3 meses anteriores como referencia.</p>
    <form id="budget-form" class="card">
      ${CATEGORIES.filter((c) => c.kind === 'gasto').map((c) => `<div class="budget-row">
        <label for="b-${c.id}"><span>${c.emoji} ${esc(c.name)}</span>
          <small class="muted">Media: ${eur(avg.get(c.id) || 0, 0)}</small></label>
        <input id="b-${c.id}" name="${c.id}" inputmode="decimal" placeholder="Sin límite" value="${budgets[c.id] ? String(budgets[c.id]).replace('.', ',') : ''}">
        ${budgets[c.id] ? budgetMeter(spent.get(c.id) || 0, budgets[c.id]) : ''}
      </div>`).join('')}
      <button class="btn primary wide">Guardar presupuestos</button>
    </form>`;
}

function viewMore() {
  return `<div class="page-head"><h1>Más</h1></div>
    <div class="card stack">
      <h2>Copia de seguridad</h2>
      <p class="prose">Todo se guarda solo en este dispositivo. Haz una copia de vez en cuando o para pasarla a otro móvil.</p>
      <div class="btn-row">
        <button class="btn" data-action="export">Descargar copia</button>
        <label class="btn file-btn">Restaurar copia<input type="file" id="restore-in" accept=".json,application/json"></label>
        <button class="btn" data-action="csv">Exportar a Excel (CSV)</button>
      </div>
    </div>
    <div class="card stack">
      <h2>Lo que la app ha aprendido</h2>
      ${rules.length ? `<ul class="list">${rules.map((r, i) => `<li class="row"><span class="row-main"><strong>${esc(r.key)}</strong>
        <span>${catById(r.category).emoji} ${esc(catById(r.category).name)}</span></span>
        <button class="icon-btn" data-forget="${i}" aria-label="Olvidar">${icon('trash')}</button></li>`).join('')}</ul>`
        : '<p class="prose">Cuando cambies la categoría de un movimiento, la app la recordará para los siguientes que se parezcan.</p>'}
    </div>
    <div class="card stack">
      <h2>Datos</h2>
      <p class="prose">${movs.length} movimientos guardados.</p>
      <div class="btn-row">
        <button class="btn" data-action="demo">Cargar datos de ejemplo</button>
        <button class="btn danger" data-action="wipe">Borrar todo</button>
      </div>
    </div>`;
}

// ---------- Router ----------
function render() {
  $('#tip')?.classList.remove('show');
  const [path, qs] = (location.hash.slice(1) || '/inicio').split('?');
  const params = new URLSearchParams(qs);
  const [, view, id] = path.split('/');
  const tab = { inicio: 'inicio', movimientos: 'movimientos', mov: 'movimientos', presupuestos: 'presupuestos', mas: 'mas' }[view];
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  nav.classList.toggle('hidden', view === 'mov' || view === 'revisar');
  const views = {
    inicio: viewHome,
    importar: viewImport,
    revisar: viewReview,
    mov: () => viewEditor(id),
    movimientos: () => viewList(params),
    presupuestos: viewBudgets,
    mas: viewMore,
  };
  app.innerHTML = (views[view] || viewHome)();
  bindTooltips(app);
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
  const names = [];
  for (const file of files) {
    try {
      const res = await readFile(file, say);
      if (res.kind === 'receipt') {
        if (files.length === 1) {
          receipt = res;
          say('');
          location.hash = '#/mov/ticket';
          return;
        }
        if (res.draft.amount) rows.push({ ...res.draft, source: 'ticket' });
      } else {
        rows.push(...res.rows.map((r) => ({ ...r, source: 'extracto' })));
      }
      names.push(file.name);
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
    files: names,
    rows: rows.map((r) => {
      const dup = movs.some((m) => sameMov(m, r));
      return { ...r, category: categorize(r.concept, r.amount, rules), dup, keep: !dup };
    }).sort((a, b) => b.date.localeCompare(a.date)),
  };
  say('');
  location.hash = '#/revisar';
}

async function saveReview() {
  const keep = review.rows.filter((r) => r.keep);
  const added = keep.map((r) => newMov(r));
  await Promise.all(added.map((m) => db.put('movs', m)));
  movs.push(...added);
  month = monthOf(added[0].date);
  review = null;
  toast(`${added.length} movimientos añadidos`);
  location.hash = '#/inicio';
}

// ---------- Datos de ejemplo ----------
async function loadDemo() {
  const demo = [];
  const base = monthOf(today());
  const rnd = (a, b) => Math.round((a + Math.random() * (b - a)) * 100) / 100;
  for (let i = 5; i >= 0; i--) {
    const ym = shiftMonth(base, -i);
    const day = (d) => `${ym}-${String(d).padStart(2, '0')}`;
    const limit = i === 0 ? Math.min(28, new Date().getDate()) : 28;
    const add = (d, concept, amount) => d <= limit && demo.push(newMov({ date: day(d), concept, amount, source: 'ejemplo' }));
    add(1, 'NOMINA EMPRESA SL', 2150);
    add(1, 'NOMINA AYUNTAMIENTO', 1480);
    add(2, 'RECIBO HIPOTECA', -720);
    add(5, 'RECIBO ENDESA ENERGIA', -rnd(55, 95));
    add(6, 'RECIBO MOVISTAR FIBRA', -58.9);
    add(8, 'RECIBO AIGUES', -rnd(28, 40));
    add(9, 'NETFLIX.COM', -13.99);
    add(9, 'SPOTIFY', -10.99);
    add(10, 'SEGURO MAPFRE HOGAR', -32.5);
    add(12, 'COLEGIO COMEDOR', -110);
    [3, 10, 17, 24].forEach((d) => add(d, 'COMPRA MERCADONA', -rnd(70, 140)));
    [7, 21].forEach((d) => add(d, 'COMPRA LIDL', -rnd(25, 60)));
    [4, 18].forEach((d) => add(d, 'REPSOL GASOLINERA', -rnd(45, 70)));
    add(14, 'RESTAURANTE LA PLAZA', -rnd(35, 80));
    add(26, 'TELEPIZZA', -rnd(18, 30));
    add(15, 'FARMACIA CENTRAL', -rnd(8, 30));
    add(20, i % 2 ? 'ZARA' : 'AMAZON MARKETPLACE', -rnd(25, 90));
    if (i === 2) add(16, 'BOOKING.COM HOTEL', -340);
    if (i === 4) add(22, 'TALLER ITV Y REVISION', -180);
  }
  await Promise.all(demo.map((m) => db.put('movs', m)));
  movs.push(...demo);
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
  const t = e.target.closest('[data-month],[data-filter],[data-action],[data-forget]');
  if (!t) return;
  if (t.dataset.month) { month = shiftMonth(month, Number(t.dataset.month)); render(); }
  if (t.dataset.filter) { filter = t.dataset.filter; render(); }
  if (t.dataset.forget) { rules.splice(Number(t.dataset.forget), 1); await saveMeta(); render(); }
  const action = t.dataset.action;
  if (action === 'demo') loadDemo();
  if (action === 'save-review') saveReview();
  if (action === 'delete') {
    const id = $('#mov-form').dataset.id;
    if (!confirm('¿Borrar este movimiento?')) return;
    await db.del('movs', id);
    movs = movs.filter((m) => m.id !== id);
    toast('Movimiento borrado');
    history.back();
  }
  if (action === 'export') {
    download(`economia-${today()}.json`, JSON.stringify({ app: 'economia', version: 1, movs, budgets, rules }, null, 1), 'application/json');
  }
  if (action === 'csv') {
    const rows = [['Fecha', 'Concepto', 'Categoría', 'Importe', 'Nota']].concat(
      [...movs].sort((a, b) => a.date.localeCompare(b.date))
        .map((m) => [m.date, m.concept, catById(m.category).name, String(m.amount).replace('.', ','), m.note]));
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    download(`movimientos-${today()}.csv`, '﻿' + csv, 'text/csv');
  }
  if (action === 'wipe') {
    if (!confirm('Se borrarán todos los movimientos, presupuestos y reglas de este dispositivo. ¿Seguro?')) return;
    await Promise.all([db.clear('movs'), db.clear('meta')]);
    movs = []; budgets = {}; rules = [];
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
      await Promise.all(data.movs.map((m) => db.put('movs', m)));
      budgets = data.budgets || {}; rules = data.rules || [];
      await saveMeta();
      movs = await db.all('movs');
      toast(`Copia restaurada: ${data.movs.length} movimientos`);
      render();
    } catch {
      toast('Ese archivo no es una copia de esta app');
    }
    t.value = '';
  }
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
      const autoCat = categorize(data.concept, amount, rules);
      Object.assign(old, { date: data.date, concept: data.concept.trim(), amount, category: data.category, note: data.note });
      await saveMov(old);
      if (data.category !== autoCat && learn(data.concept, data.category)) toast('Guardado. Lo recordaré para la próxima vez');
      else toast('Guardado');
    } else {
      const m = newMov({ ...data, amount, source: receipt && location.hash.endsWith('ticket') ? 'ticket' : 'manual' });
      if (data.category !== m.category) learn(data.concept, data.category);
      m.category = data.category;
      await db.put('movs', m);
      movs.push(m);
      receipt = null;
      month = monthOf(m.date);
      toast('Movimiento guardado');
    }
    location.hash = '#/inicio';
  }
  if (f.id === 'budget-form') {
    budgets = {};
    for (const [k, v] of new FormData(f)) {
      const n = parseNum(v);
      if (v.trim() && n > 0) budgets[k] = n;
    }
    await saveMeta();
    toast('Presupuestos guardados');
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

nav.querySelector('.fab').addEventListener('click', () => { location.hash = '#/importar'; });
window.addEventListener('hashchange', render);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

await load();
render();
