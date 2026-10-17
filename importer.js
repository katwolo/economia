// Lectura de archivos: extractos del banco (CSV, Excel, PDF) y tickets o facturas (PDF o foto).
// Todo se procesa en el propio dispositivo; las librerías se descargan la primera vez que se usan.
const LIBS = {
  xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  ocr: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
};
const loading = {};

function loadScript(name, ready) {
  if (ready()) return Promise.resolve();
  if (!loading[name]) {
    loading[name] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIBS[name];
      s.onload = resolve;
      s.onerror = () => {
        loading[name] = null;
        reject(new Error('No se pudo descargar el lector de archivos (¿sin conexión?)'));
      };
      document.head.appendChild(s);
    });
  }
  return loading[name];
}

// ---------- Números y fechas ----------
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const validDate = (y, m, d) => y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

// "1.234,56 €", "-12,30", "1,234.56", "(45.00)" -> número; null si no es un importe.
export function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value == null) return null;
  let s = String(value).trim().replace(/\s|€|eur(os)?/gi, '');
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/-$/.test(s)) { sign = -1; s = s.slice(0, -1); }
  if (/^[+-]/.test(s)) { if (s[0] === '-') sign *= -1; s = s.slice(1); }
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot > -1 && lastComma > -1) {
    const dec = lastDot > lastComma ? '.' : ',';
    s = s.replace(dec === '.' ? /,/g : /\./g, '').replace(',', '.');
  } else if (lastComma > -1) {
    s = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (s.split('.').length > 2 || /^\d{1,3}\.\d{3}$/.test(s)) {
    s = s.replace(/\./g, ''); // en los bancos españoles "1.234" son mil doscientos
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(sign * n * 100) / 100 : null;
}

// "17/10/2026", "17-10-26", "2026-10-17", "17 oct 2026", Date de Excel -> "2026-10-17".
export function parseDate(value) {
  if (value instanceof Date && !isNaN(value)) {
    return iso(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number' && value > 30000 && value < 80000) {
    const d = new Date(Math.round((value - 25569) * 86400000)); // número de serie de Excel
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(value ?? '').trim().toLowerCase();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m && validDate(+m[1], +m[2], +m[3])) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (validDate(y, +m[2], +m[1])) return iso(y, +m[2], +m[1]);
  }
  m = s.match(/^(\d{1,2})\s*(?:de\s+)?([a-zé]{3})[a-zé]*\.?\s*(?:de\s+)?(\d{4})/);
  if (m && MONTHS.includes(m[2])) {
    const mo = MONTHS.indexOf(m[2]) + 1;
    if (validDate(+m[3], mo, +m[1])) return iso(+m[3], mo, +m[1]);
  }
  return null;
}

// Busca una fecha en cualquier parte de un texto.
function findDate(text) {
  const re = /(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s+(?:de\s+)?[a-zé]{3,10}\.?\s+(?:de\s+)?\d{4})/gi;
  for (const m of text.matchAll(re)) {
    const d = parseDate(m[1]);
    if (d) return d;
  }
  return null;
}

const AMOUNT_RE = /[-+]?\(?\d{1,3}(?:[.\s]\d{3})*[.,]\d{2}\)?-?|[-+]?\d+[.,]\d{2}-?/g;

// ---------- Tablas (CSV y Excel) ----------
const HEAD = {
  date: /^(f\.?\s*)?fecha|^date|^dia$|^data/,
  valueDate: /valor/,
  concept: /concepto|descrip|detalle|movimiento|operaci|comercio|beneficiario|observ|^texto|^concept/,
  amount: /^importe|^cantidad|^amount|^import\b|^import$|^euros?$|^valor$/,
  debit: /cargo|^debe|gasto|salida|reintegro|d[eé]bito/,
  credit: /abono|haber|ingreso|entrada|cr[eé]dito/,
  balance: /saldo|balance/,
};
const norm = (v) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = rows[i].map(norm);
    const has = (re) => cells.findIndex((c) => re.test(c));
    const date = cells.findIndex((c) => HEAD.date.test(c) && !HEAD.valueDate.test(c));
    const anyDate = date > -1 ? date : has(HEAD.date);
    const amount = cells.findIndex((c) => HEAD.amount.test(c) && !HEAD.balance.test(c));
    const debit = has(HEAD.debit);
    const credit = has(HEAD.credit);
    if (anyDate > -1 && (amount > -1 || debit > -1 || credit > -1)) {
      const concept = cells.findIndex((c) => HEAD.concept.test(c) && !HEAD.date.test(c));
      return { row: i, date: anyDate, concept, amount, debit, credit };
    }
  }
  return null;
}

// Sin encabezados: adivina por el contenido de las columnas.
function guessColumns(rows) {
  const width = Math.max(...rows.map((r) => r.length));
  const score = (fn, c) => rows.filter((r) => fn(r[c])).length / rows.length;
  const cols = [...Array(width).keys()];
  const date = cols.reduce((b, c) => (score(parseDate, c) > score(parseDate, b) ? c : b), 0);
  const isAmount = (v) => parseAmount(v) !== null && parseDate(v) === null;
  const numeric = cols.filter((c) => c !== date && score(isAmount, c) > 0.6);
  const text = cols
    .filter((c) => c !== date && !numeric.includes(c))
    .sort((a, b) => avgLen(rows, b) - avgLen(rows, a));
  if (score(parseDate, date) < 0.6 || !numeric.length) return null;
  // Si hay dos columnas numéricas suele ser "importe, saldo": la primera es el importe.
  return { row: -1, date, concept: text[0] ?? -1, amount: numeric[0], debit: -1, credit: -1 };
}
const avgLen = (rows, c) => rows.reduce((s, r) => s + String(r[c] ?? '').length, 0) / rows.length;

function rowsToMovements(rows) {
  rows = rows.filter((r) => r && r.some((c) => String(c ?? '').trim()));
  const map = findHeader(rows) || guessColumns(rows);
  if (!map) return [];
  const out = [];
  for (const r of rows.slice(map.row + 1)) {
    const date = parseDate(r[map.date]);
    if (!date) continue;
    let amount = map.amount > -1 ? parseAmount(r[map.amount]) : null;
    if (amount === null) {
      const debit = map.debit > -1 ? parseAmount(r[map.debit]) : null;
      const credit = map.credit > -1 ? parseAmount(r[map.credit]) : null;
      if (debit) amount = -Math.abs(debit);
      else if (credit) amount = Math.abs(credit);
    }
    if (!amount) continue;
    const concept = map.concept > -1
      ? String(r[map.concept] ?? '').trim()
      : r.filter((c, i) => i !== map.date && parseAmount(c) === null).join(' ').trim();
    out.push({ date, concept: concept || 'Movimiento', amount });
  }
  return out;
}

export function parseCsv(text) {
  const first = text.split(/\r?\n/).slice(0, 10).join('\n');
  const delim = [';', '\t', ',', '|'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function readSheet(file) {
  await loadScript('xlsx', () => window.XLSX);
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  let best = [];
  for (const name of wb.SheetNames) {
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    const movs = rowsToMovements(rows);
    if (movs.length > best.length) best = movs;
  }
  return best;
}

// Los CSV de algunos bancos vienen en Windows-1252 (las tildes salen mal si se leen como UTF-8).
async function readText(file) {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

// ---------- PDF ----------
async function pdfLib() {
  await loadScript('pdf', () => window.pdfjsLib);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
  return window.pdfjsLib;
}

// Texto del PDF reconstruyendo las líneas por su posición vertical.
async function pdfText(file, onStatus) {
  const lib = await pdfLib();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const lines = [];
  for (let p = 1; p <= Math.min(doc.numPages, 30); p++) {
    onStatus?.(`Leyendo página ${p} de ${doc.numPages}…`);
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    const byY = new Map();
    for (const it of items) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push(it);
    }
    [...byY.entries()]
      .sort((a, b) => b[0] - a[0])
      .forEach(([, its]) => lines.push(its.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join('  ')));
  }
  return { doc, text: lines.join('\n') };
}

async function pdfFirstPageImage(doc) {
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas;
}

// ---------- OCR ----------
async function ocr(image, onStatus) {
  await loadScript('ocr', () => window.Tesseract);
  const { data } = await window.Tesseract.recognize(image, 'spa', {
    logger: (m) => {
      if (m.status === 'recognizing text') onStatus?.(`Leyendo el texto… ${Math.round(m.progress * 100)} %`);
      else onStatus?.('Preparando el lector de texto (la primera vez tarda un poco)…');
    },
  });
  return data.text || '';
}

// ---------- Extractos en texto (PDF del banco) ----------
// Líneas del tipo "03/10/2026  COMPRA MERCADONA  -45,20  1.234,56".
function textToMovements(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?)\s+(?:\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?\s+)?(.*)$/);
    if (!m) continue;
    let datePart = m[1];
    if (!/[-/.]\d{1,2}[-/.]\d{2,4}$/.test(datePart)) datePart += `/${new Date().getFullYear()}`;
    const date = parseDate(datePart);
    const amounts = [...m[2].matchAll(AMOUNT_RE)];
    if (!date || !amounts.length) continue;
    // Con dos importes al final, el último suele ser el saldo.
    const pick = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0];
    const amount = parseAmount(pick[0]);
    if (!amount) continue;
    const concept = m[2].slice(0, amounts[0].index).trim();
    out.push({ date, concept: concept || 'Movimiento', amount });
  }
  return out;
}

// ---------- Tickets y facturas ----------
export function parseReceipt(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const amountsIn = (l) => [...l.matchAll(AMOUNT_RE)].map((m) => Math.abs(parseAmount(m[0]))).filter((n) => n > 0);
  let total = null;
  const totalLines = lines.filter((l) => /total|a pagar|importe|suma|tarjeta|efectivo/i.test(l) && !/sub\s*-?total|base|iva\s*\d/i.test(l));
  for (const l of totalLines.filter((l) => /total|a pagar/i.test(l)).concat(totalLines)) {
    const a = amountsIn(l);
    if (a.length) { total = Math.max(...a); break; }
  }
  if (total === null) {
    const all = lines.flatMap(amountsIn).filter((n) => n < 100000);
    total = all.length ? Math.max(...all) : null;
  }
  const merchant = lines.find((l) => /[a-záéíóúñ]{3,}/i.test(l) && !/factura|ticket|simplificada|fecha|cif|nif|tel/i.test(l)) || '';
  return {
    date: findDate(text) || new Date().toISOString().slice(0, 10),
    concept: merchant.replace(/\s{2,}/g, ' ').slice(0, 60),
    amount: total === null ? null : -total,
  };
}

// ---------- Entrada principal ----------
// Devuelve { kind: 'movements', rows } para extractos o { kind: 'receipt', draft, text } para tickets.
export async function readFile(file, onStatus) {
  const name = file.name.toLowerCase();
  onStatus?.(`Abriendo ${file.name}…`);
  if (/\.(csv|txt|tsv)$/.test(name)) {
    return { kind: 'movements', rows: rowsToMovements(parseCsv(await readText(file))) };
  }
  if (/\.(xlsx|xls|ods)$/.test(name)) {
    return { kind: 'movements', rows: await readSheet(file) };
  }
  let text = '';
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const res = await pdfText(file, onStatus);
    text = res.text;
    if (text.replace(/\s/g, '').length < 30) {
      // PDF escaneado: sin texto, hay que leer la imagen.
      text = await ocr(await pdfFirstPageImage(res.doc), onStatus);
    }
  } else if (file.type.startsWith('image/')) {
    text = await ocr(file, onStatus);
  } else {
    throw new Error(`No sé leer este tipo de archivo: ${file.name}`);
  }
  const rows = textToMovements(text);
  if (rows.length >= 3) return { kind: 'movements', rows, text };
  return { kind: 'receipt', draft: parseReceipt(text), text };
}
