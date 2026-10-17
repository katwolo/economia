// Categorías y clasificación automática de movimientos por palabras clave.

// [id, nombre, emoji, tipo]  (tipo: 'gasto' o 'ingreso')
export const CATEGORIES = [
  ['super', 'Supermercado', '🛒', 'gasto'],
  ['casa', 'Vivienda', '🏠', 'gasto'],
  ['suministros', 'Luz, agua, gas e internet', '💡', 'gasto'],
  ['transporte', 'Transporte y coche', '🚗', 'gasto'],
  ['salud', 'Salud', '💊', 'gasto'],
  ['educacion', 'Educación e hijos', '🎒', 'gasto'],
  ['restaurantes', 'Bares y restaurantes', '🍽️', 'gasto'],
  ['ocio', 'Ocio y viajes', '🎟️', 'gasto'],
  ['ropa', 'Ropa y compras', '🛍️', 'gasto'],
  ['suscripciones', 'Suscripciones', '📺', 'gasto'],
  ['seguros', 'Seguros', '🛡️', 'gasto'],
  ['impuestos', 'Impuestos y comisiones', '🏛️', 'gasto'],
  ['otros', 'Otros gastos', '📦', 'gasto'],
  ['nomina', 'Nómina', '💼', 'ingreso'],
  ['otros_ingresos', 'Otros ingresos', '💶', 'ingreso'],
].map(([id, name, emoji, kind]) => ({ id, name, emoji, kind }));

export const catById = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES.find((c) => c.id === 'otros');

// Palabras que suelen aparecer en los conceptos del banco o en los tickets.
const KEYWORDS = {
  super: ['mercadona', 'carrefour', 'lidl', 'aldi', 'dia ', 'eroski', 'alcampo', 'consum', 'bonpreu', 'caprabo',
    'condis', 'hipercor', 'supermerc', 'ahorramas', 'froiz', 'gadis', 'covirán', 'coviran', 'spar', 'fruteria',
    'carniceria', 'panaderia', 'bonarea'],
  casa: ['alquiler', 'hipoteca', 'comunidad de propietarios', 'comunidad prop', 'ikea', 'leroy merlin', 'bricomart',
    'brico'],
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
    'gimnasio', 'gym', 'entradas', 'ticketmaster', 'parque'],
  ropa: ['zara', 'primark', 'h&m', 'mango', 'pull&bear', 'bershka', 'corte ingles', 'amazon', 'aliexpress',
    'shein', 'zalando', 'mediamarkt', 'fnac', 'pccomponentes'],
  suscripciones: ['netflix', 'spotify', 'hbo', 'max ', 'disney', 'prime video', 'apple.com', 'icloud', 'google',
    'youtube', 'dazn', 'filmin', 'movistar+', 'audible', 'chatgpt', 'openai', 'anthropic', 'claude'],
  seguros: ['seguro', 'mapfre', 'mutua', 'allianz', 'axa', 'generali', 'linea directa', 'reale', 'zurich',
    'catalana occidente', 'santalucia', 'ocaso'],
  impuestos: ['agencia tributaria', 'aeat', 'hacienda', 'ibi', 'ayuntamiento', 'ajuntament', 'tasa', 'impuesto',
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
  const matches = (cat) => KEYWORDS[cat].some((w) => plain.includes(strip(w)));
  // Un ingreso es nómina u "otros ingresos"; así "NÓMINA AYUNTAMIENTO" no acaba en impuestos.
  if (amount >= 0) return matches('nomina') ? 'nomina' : 'otros_ingresos';
  return Object.keys(KEYWORDS).find((cat) => cat !== 'nomina' && matches(cat)) || 'otros';
}
