/**
 * Economía familiar — backend en Google Apps Script.
 *
 * Pega este archivo en Extensiones > Apps Script de tu hoja de cálculo.
 * - Los movimientos, presupuestos y reglas se guardan en las pestañas "Movimientos",
 *   "Presupuestos" y "Reglas".
 * - Las fotos y PDF de los tickets se guardan en una carpeta de Drive que se crea sola.
 * Pasos completos en el README.
 */

// La clave NO va aquí: está en Configuración del proyecto > Propiedades del script,
// con el nombre TOKEN. Así puedes pegar versiones nuevas de este archivo sin tocarla.
// Pon la misma clave en la app (Más > Google Sheets y Drive).
const TOKEN_PROPERTY = 'TOKEN';
// Carpeta de Drive para los tickets. Se crea la primera vez y su ID queda en la propiedad
// FOLDER_ID; si prefieres otra carpeta, cambia esa propiedad por el ID de la tuya.
const FOLDER_PROPERTY = 'FOLDER_ID';
const FOLDER_NAME = 'Economía familiar - tickets';

const MAX_CELL = 49000; // Sheets admite 50.000 caracteres por celda

// Las mismas categorías que categories.js (si añades una allí, añádela aquí).
const CATEGORIAS = {
  super: 'Supermercado',
  casa: 'Vivienda',
  suministros: 'Luz, agua, gas e internet',
  transporte: 'Transporte y coche',
  salud: 'Salud',
  educacion: 'Educación e hijos',
  restaurantes: 'Bares y restaurantes',
  ocio: 'Ocio y viajes',
  ropa: 'Ropa y compras',
  suscripciones: 'Suscripciones',
  seguros: 'Seguros',
  impuestos: 'Impuestos y comisiones',
  otros: 'Otros gastos',
  nomina: 'Nómina',
  otros_ingresos: 'Otros ingresos',
};
const INGRESOS = ['nomina', 'otros_ingresos'];

// [clave en la app, encabezado en la hoja, formato]
const TABLES = {
  movs: {
    sheet: 'Movimientos',
    uuid: true,
    cols: [
      ['date', 'Fecha', 'date'],
      ['concept', 'Concepto'],
      ['category', 'Categoría', 'cat'],
      ['amount', 'Importe', 'money'],
      ['kind', 'Tipo', 'computed'],
      ['note', 'Nota'],
      ['driveUrl', 'Ticket'],
      ['source', 'Origen'],
      ['modified', 'Modificado', 'readable'],
      ['id', 'ID'],
      ['driveId', 'ID archivo'],
      ['mime', 'Tipo archivo'],
      ['createdAt', 'Creado', 'num'],
      ['updatedAt', 'Actualizado', 'num'],
      ['deleted', 'Borrado', 'bool'],
    ],
  },
  budgets: {
    sheet: 'Presupuestos',
    cols: [
      ['id', 'Categoría', 'cat'],
      ['limit', 'Límite al mes', 'money'],
      ['modified', 'Modificado', 'readable'],
      ['updatedAt', 'Actualizado', 'num'],
    ],
  },
  rules: {
    sheet: 'Reglas',
    cols: [
      ['id', 'Concepto parecido a'],
      ['category', 'Categoría', 'cat'],
      ['modified', 'Modificado', 'readable'],
      ['updatedAt', 'Actualizado', 'num'],
      ['deleted', 'Borrado', 'bool'],
    ],
  },
};

const FORMATS = { date: 'dd/mm/yyyy', money: '#,##0.00 €', num: '0' };

// ---------- Entradas web ----------
function doGet() {
  return ContentService.createTextOutput('Economía familiar: el servicio funciona.');
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const token = getToken_();
    if (!token) return json_({ ok: false, error: 'Falta la propiedad TOKEN en las propiedades del script' });
    if (req.token !== token) return json_({ ok: false, error: 'Clave incorrecta' });
    switch (req.action) {
      case 'ping':
        return json_({ ok: true });
      case 'sync':
        return json_(Object.assign({ ok: true }, withLock_(() => sync_(req))));
      case 'upload':
        return json_(Object.assign({ ok: true }, upload_(req)));
      case 'file':
        return json_(Object.assign({ ok: true }, file_(req)));
      default:
        return json_({ ok: false, error: 'Acción desconocida' });
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

/** Ejecútala una vez desde el editor para dar permisos y crear las pestañas y la carpeta. */
function configurar() {
  if (!getToken_()) {
    throw new Error('Añade la propiedad TOKEN en Configuración del proyecto > Propiedades del script');
  }
  Object.keys(TABLES).forEach(table_);
  const vacia = SpreadsheetApp.getActive().getSheetByName('Hoja 1') || SpreadsheetApp.getActive().getSheetByName('Sheet1');
  if (vacia && vacia.getLastRow() === 0 && SpreadsheetApp.getActive().getSheets().length > 1) {
    SpreadsheetApp.getActive().deleteSheet(vacia);
  }
  Logger.log('Todo listo. Carpeta de Drive: ' + folder_().getName());
}

/**
 * Si editas o añades una fila a mano en la hoja, se marca como cambiada para que llegue a la app.
 * En una fila nueva de un gasto puedes escribir el importe en positivo: se pone en negativo solo.
 */
function onEdit(e) {
  const sh = e.range.getSheet();
  const key = Object.keys(TABLES).find((k) => TABLES[k].sheet === sh.getName());
  if (!key) return;
  const t = TABLES[key];
  const first = Math.max(2, e.range.getRow());
  const last = e.range.getLastRow();
  if (last < first) return;
  const n = last - first + 1;
  const rows = sh.getRange(first, 1, n, t.cols.length).getValues();
  const col = (k) => t.cols.findIndex((c) => c[0] === k);
  const now = String(Date.now());
  const touched = {};
  const set = (k, i, v) => {
    if (col(k) < 0) return;
    rows[i][col(k)] = v;
    touched[k] = true;
  };
  const editedCol = (k) => col(k) >= 0 && e.range.getColumn() <= col(k) + 1 && col(k) + 1 <= e.range.getLastColumn();
  rows.forEach((row, i) => {
    if (row.every((v) => v === '')) return;
    if (t.uuid && !row[col('id')]) {
      set('id', i, Utilities.getUuid());
      set('createdAt', i, now);
    }
    // Signo del importe: los gastos en negativo y los ingresos en positivo.
    if (key === 'movs' && (editedCol('amount') || editedCol('category'))) {
      const income = INGRESOS.indexOf(catId_(row[col('category')])) >= 0;
      const amount = toNumber_(row[col('amount')]);
      if (editedCol('amount') && amount > 0 && !income) set('amount', i, -amount);
      if (editedCol('category') && amount < 0 && income) set('amount', i, -amount);
    }
    set('updatedAt', i, now);
  });
  Object.keys(touched).forEach((k) => {
    const c = col(k);
    sh.getRange(first, c + 1, n, 1).setValues(rows.map((r) => [r[c]]));
  });
}

// ---------- Sincronización ----------
function sync_(req) {
  const out = {};
  Object.keys(TABLES).forEach((key) => {
    out[key] = mergeTable_(key, req[key] || []);
  });
  return out;
}

// Une lo que llega con lo que hay en la hoja: gana la versión más reciente.
function mergeTable_(key, incoming) {
  const sh = table_(key);
  const t = TABLES[key];
  const records = readRecords_(t, sh);
  const index = {};
  records.forEach((r, i) => (index[r.id] = i));
  let changed = false;

  incoming.forEach((rec) => {
    if (!rec || !rec.id) return;
    const i = index[rec.id];
    if (i === undefined) {
      if (rec.deleted) return;
      index[rec.id] = records.push(pick_(t, rec)) - 1;
      changed = true;
      return;
    }
    const cur = records[i];
    if (Number(rec.updatedAt) < Number(cur.updatedAt)) return;
    if (cur.driveId && (rec.deleted || rec.driveId !== cur.driveId)) trash_(cur.driveId);
    records[i] = rec.deleted
      ? Object.assign({}, cur, { deleted: true, updatedAt: Number(rec.updatedAt) })
      : pick_(t, rec);
    changed = true;
  });

  if (changed) {
    // Los movimientos más recientes, arriba.
    if (key === 'movs') records.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const rows = records.map((r) => t.cols.map((c) => toCell_(c, r)));
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, t.cols.length).clearContent();
    if (rows.length) {
      t.cols.forEach((c, i) => sh.getRange(2, i + 1, rows.length, 1).setNumberFormat(FORMATS[c[2]] || '@'));
      sh.getRange(2, 1, rows.length, t.cols.length).setValues(rows);
    }
  }
  return records;
}

function table_(key) {
  const t = TABLES[key];
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(t.sheet);
  if (!sh) sh = ss.insertSheet(t.sheet);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, t.cols.length).setValues([t.cols.map((c) => c[1])]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // Desplegable con las categorías para poder elegirlas al editar a mano.
    const names = Object.keys(CATEGORIAS).map((k) => CATEGORIAS[k]);
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(names, true).setAllowInvalid(true).build();
    t.cols.forEach((c, i) => {
      const range = sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1);
      range.setNumberFormat(FORMATS[c[2]] || '@');
      if (c[2] === 'cat') range.setDataValidation(rule);
    });
  }
  return sh;
}

function readRecords_(t, sh) {
  if (sh.getLastRow() < 2) return [];
  const idCol = t.cols.findIndex((c) => c[0] === 'id');
  return sh
    .getRange(2, 1, sh.getLastRow() - 1, t.cols.length)
    .getValues()
    .filter((row) => row[idCol] !== '')
    .map((row) => {
      const rec = {};
      t.cols.forEach((c, i) => {
        const v = fromCell_(c, row[i]);
        if (v !== undefined) rec[c[0]] = v;
      });
      return rec;
    });
}

// Normaliza lo que llega de la app para que sea igual que lo leído de la hoja.
function pick_(t, rec) {
  const out = {};
  t.cols.forEach((c) => {
    if (c[2] === 'readable' || c[2] === 'computed') return;
    const v = rec[c[0]];
    // Los textos se devuelven tal cual, sin el apóstrofo que se añade al escribirlos en la hoja.
    out[c[0]] = c[2] ? fromCell_(c, toCell_(c, rec)) : v === undefined || v === null ? '' : String(v).slice(0, MAX_CELL);
  });
  return out;
}

function toCell_(c, rec) {
  const v = rec[c[0]];
  switch (c[2]) {
    case 'num': return Number(v) || 0;
    case 'money': return Math.round((Number(v) || 0) * 100) / 100;
    case 'bool': return v ? 'Sí' : '';
    case 'cat': return CATEGORIAS[v] || CATEGORIAS.otros;
    case 'date': {
      const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : '';
    }
    case 'readable':
      return Utilities.formatDate(new Date(Number(rec.updatedAt) || 0), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    case 'computed': return INGRESOS.indexOf(rec.category) >= 0 ? 'Ingreso' : 'Gasto';
    default: {
      const s = v === undefined || v === null ? '' : String(v).slice(0, MAX_CELL);
      // El apóstrofo evita que Sheets tome "= + - @" iniciales por una fórmula (no se ve ni se lee).
      return /^[=+\-@]/.test(s) ? "'" + s : s;
    }
  }
}

function fromCell_(c, v) {
  switch (c[2]) {
    case 'readable':
    case 'computed': return undefined;
    case 'num': return Number(v) || 0;
    case 'money': return Math.round(toNumber_(v) * 100) / 100;
    case 'bool': return v === true || v === 'Sí' || v === 'TRUE';
    case 'cat': return catId_(v);
    case 'date': return toIsoDate_(v);
    default: return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v);
  }
}

// "Supermercado", "supermercado" o "super" -> "super". Lo que no se reconoce va a "Otros gastos".
function catId_(v) {
  const s = String(v || '').trim().toLowerCase();
  if (CATEGORIAS[s]) return s;
  const k = Object.keys(CATEGORIAS).find((id) => CATEGORIAS[id].toLowerCase() === s);
  return k || 'otros';
}

// Acepta números de la hoja y textos como "1.234,56 €" o "-12,30".
function toNumber_(v) {
  if (typeof v === 'number') return v;
  let s = String(v || '').replace(/\s|€/g, '');
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  return Number(s) || 0;
}

function toIsoDate_(v) {
  const tz = Session.getScriptTimeZone();
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  }
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

// ---------- Archivos en Drive ----------
function folder_() {
  const props = PropertiesService.getScriptProperties();
  const id = (props.getProperty(FOLDER_PROPERTY) || '').trim();
  if (id) return DriveApp.getFolderById(id);
  const folder = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty(FOLDER_PROPERTY, folder.getId());
  return folder;
}

function upload_(req) {
  const blob = Utilities.newBlob(Utilities.base64Decode(req.data), req.mime || 'application/octet-stream', req.name || 'ticket');
  const file = folder_().createFile(blob);
  return { id: file.getId(), url: file.getUrl() };
}

function file_(req) {
  const file = DriveApp.getFileById(req.id);
  if (!inFolder_(file)) throw new Error('El archivo no está en la carpeta de tickets');
  const blob = file.getBlob();
  return { mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

function trash_(id) {
  try {
    const file = DriveApp.getFileById(id);
    if (inFolder_(file)) file.setTrashed(true);
  } catch (err) {
    // ya no existe: nada que hacer
  }
}

function inFolder_(file) {
  const folderId = folder_().getId();
  const parents = file.getParents();
  while (parents.hasNext()) if (parents.next().getId() === folderId) return true;
  return false;
}

// ---------- Utilidades ----------
function getToken_() {
  return (PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY) || '').trim();
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
