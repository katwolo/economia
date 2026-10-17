// Categorías y clasificación automática de movimientos por palabras clave.

// Como en las plantillas de presupuesto familiar: gastos fijos (recibos que llegan cada mes o cada
// cierto tiempo), gastos variables (cambian de un mes a otro), ahorro e ingresos.
// "need" marca lo que cuenta como necesidad en la regla 50/30/20 (lo demás son caprichos).
// [id, nombre, emoji, grupo, necesidad]
export const CATEGORIES = [
  ['casa', 'Alquiler o hipoteca', '🏠', 'fijo', true],
  ['comunidad', 'Comunidad e IBI', '🏢', 'fijo', true],
  ['suministros', 'Luz, agua, gas e internet', '💡', 'fijo', true],
  ['seguros', 'Seguros', '🛡️', 'fijo', true],
  ['prestamos', 'Préstamos y tarjetas', '💳', 'fijo', true],
  ['educacion', 'Colegio y guardería', '🎒', 'fijo', true],
  ['suscripciones', 'Suscripciones y cuotas', '📺', 'fijo', false],
  ['impuestos', 'Impuestos y comisiones', '🏛️', 'fijo', true],
  ['super', 'Alimentación y súper', '🛒', 'variable', true],
  ['transporte', 'Transporte y gasolina', '🚗', 'variable', true],
  ['salud', 'Salud y farmacia', '💊', 'variable', true],
  ['hogar', 'Hogar y reparaciones', '🔧', 'variable', true],
  ['restaurantes', 'Bares y restaurantes', '🍽️', 'variable', false],
  ['ocio', 'Ocio y viajes', '🎟️', 'variable', false],
  ['ropa', 'Ropa y compras', '🛍️', 'variable', false],
  ['regalos', 'Regalos y celebraciones', '🎁', 'variable', false],
  ['otros', 'Otros gastos', '📦', 'variable', false],
  ['ahorro', 'Ahorro e inversión', '🐷', 'ahorro', false],
  ['nomina', 'Nómina', '💼', 'ingreso', false],
  ['otros_ingresos', 'Otros ingresos', '💶', 'ingreso', false],
].map(([id, name, emoji, group, need]) => ({ id, name, emoji, group, need, kind: group === 'ingreso' ? 'ingreso' : 'gasto' }));

export const GROUPS = {
  fijo: 'Gastos fijos',
  variable: 'Gastos variables',
  ahorro: 'Ahorro',
  ingreso: 'Ingresos',
};

export const catById = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES.find((c) => c.id === 'otros');

// Palabras que suelen aparecer en los conceptos del banco o en los tickets.
const KEYWORDS = {
  super: ['mercadona', 'carrefour', 'lidl', 'aldi', 'dia ', 'eroski', 'alcampo', 'consum', 'bonpreu', 'caprabo',
    'condis', 'hipercor', 'supermerc', 'ahorramas', 'froiz', 'gadis', 'covirán', 'coviran', 'spar', 'fruteria',
    'carniceria', 'panaderia', 'bonarea'],
  casa: ['alquiler', 'hipoteca'],
  comunidad: ['comunidad de propietarios', 'comunidad prop', 'cdad prop', 'ibi', 'basuras'],
  prestamos: ['prestamo', 'préstamo', 'financiacion', 'cuota tarjeta', 'credito', 'cofidis', 'cetelem'],
  hogar: ['ikea', 'leroy merlin', 'bricomart', 'brico', 'ferreteria', 'fontaner', 'electricista', 'cerrajer'],
  regalos: ['regalo', 'floristeria', 'juguet', 'toys'],
  ahorro: ['traspaso a ahorro', 'cuenta ahorro', 'plan de pensiones', 'fondo de inversion', 'indexa', 'myinvestor'],
  suministros: ['endesa', 'iberdrola', 'naturgy', 'repsol luz', 'holaluz', 'totalenergies', 'aigues', 'aguas',
    'canal de isabel', 'movistar', 'vodafone', 'orange', 'digi', 'masmovil', 'yoigo', 'pepephone', 'jazztel',
    'lowi', 'o2 ', 'fibra', 'butano'],
  transporte: ['repsol', 'cepsa', 'galp', 'bp ', 'shell', 'petronor', 'gasolin', 'parking', 'aparcamiento', 'renfe',
    'metro', 'tmb', 'emt', 'autopista', 'peaje', 'cabify', 'uber', 'taxi', 'itv', 'taller', 'blablacar', 'bicing'],
  salud: ['farmacia', 'clinica', 'dentista', 'hospital', 'optica', 'fisio', 'medic', 'sanitas', 'adeslas',
    'dkv', 'asisa', 'veterinari'],
  educacion: ['colegio', 'escola', 'escuela', 'guarderia', 'llar d', 'academia', 'universidad', 'libreria',
    'matricula', 'comedor', 'extraescolar', 'ampa'],
  restaurantes: ['restaurante', 'bar ', 'cafeteria', 'cafe ', 'burger', 'mcdonald', 'telepizza', 'domino',
    'just eat', 'glovo', 'uber eats', 'kfc', 'pizzeria', 'tapas', 'cerveceria', 'vips', 'foster'],
  ocio: ['cine', 'teatro', 'museo', 'booking', 'airbnb', 'ryanair', 'vueling', 'iberia', 'hotel', 'decathlon',
    'entradas', 'ticketmaster', 'parque'],
  ropa: ['zara', 'primark', 'h&m', 'mango', 'pull&bear', 'bershka', 'corte ingles', 'amazon', 'aliexpress',
    'shein', 'zalando', 'mediamarkt', 'fnac', 'pccomponentes'],
  suscripciones: ['netflix', 'spotify', 'hbo', 'max ', 'disney', 'prime video', 'apple.com', 'icloud', 'google',
    'youtube', 'dazn', 'filmin', 'movistar+', 'audible', 'chatgpt', 'openai', 'anthropic', 'claude', 'gimnasio',
    'gym', 'basic fit', 'altafit', 'cuota socio'],
  seguros: ['seguro', 'mapfre', 'mutua', 'allianz', 'axa', 'generali', 'linea directa', 'reale', 'zurich',
    'catalana occidente', 'santalucia', 'ocaso'],
  impuestos: ['agencia tributaria', 'aeat', 'hacienda', 'ayuntamiento', 'ajuntament', 'tasa', 'impuesto',
    'comision', 'dgt', 'multa', 'seguridad social', 'autonomo'],
  nomina: ['nomina', 'nómina', 'salario', 'sueldo', 'pension', 'pensión', 'paga extra'],
};

// Quita acentos, números y códigos para comparar conceptos parecidos.
export function normalize(text = '') {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\d+[\d/.,:-]*/g, ' ')
    .replace(/\b(compra|pago|tarj(eta)?|recibo|transferencia|trans|bizum|en|de|a|the|card|cargo|adeudo|com|www)\b/g, ' ')
    .replace(/[^a-z&+ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Clave corta de un concepto ("COMPRA TARJ. 1234 MERCADONA VALENCIA" -> "mercadona valencia").
export const conceptKey = (text) => normalize(text).split(' ').slice(0, 3).join(' ');

// rules: [{ key, category }] aprendidas al corregir la categoría de un movimiento.
export function categorize(text, amount, rules = []) {
  const key = conceptKey(text);
  const learned = key && rules.find((r) => r.key === key);
  if (learned) return learned.category;
  const strip = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const plain = ` ${strip(text)} `;
  // Palabras de pocas letras ("ibi", "gym") solo cuentan como palabra entera.
  const has = (w) => (strip(w).length <= 3 ? new RegExp(`\\b${strip(w).trim()}\\b`).test(plain) : plain.includes(strip(w)));
  const matches = (cat) => KEYWORDS[cat].some(has);
  // Un ingreso es nómina u "otros ingresos"; así "NÓMINA AYUNTAMIENTO" no acaba en impuestos.
  if (amount >= 0) return matches('nomina') ? 'nomina' : 'otros_ingresos';
  // Primero lo más concreto: "comunidad", "préstamo" o "ahorro" antes que palabras genéricas.
  const order = ['ahorro', 'comunidad', 'prestamos', ...Object.keys(KEYWORDS)];
  return order.find((cat) => cat !== 'nomina' && matches(cat)) || 'otros';
}
