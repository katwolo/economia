# Economía familiar

App para llevar las cuentas de casa, instalable en el móvil (PWA) y que funciona sin conexión.
Sigue la misma idea que *Notes*: todo se guarda primero en el dispositivo (IndexedDB), así que
no necesita internet, y si conectas Google se sincroniza con una hoja de cálculo y una carpeta
de Drive.

## Qué hace

Está organizada como las plantillas y apps de presupuesto familiar: **ingresos**, **gastos fijos**,
**gastos variables** y **ahorro**, y pensada para una pareja que la usa a la vez.

- **Resumen del mes**: lo que entra, lo que se va en fijos y en variables, lo apartado a ahorro y
  lo que queda. Gráfico de los últimos 6 meses, gasto variable por categoría y quién ha gastado.
- **Gastos fijos**: los recibos que llegan cada mes o cada cierto tiempo (hipoteca, luz, seguros,
  colegio, IBI anual...), con su día de cobro. Cada mes ves cuáles están **pagados** y cuáles
  **pendientes**; al importar el extracto del banco se marcan solos, o con el botón *Pagar*.
  Avisa de cuánto apartar al mes para los recibos que no son mensuales y propone como fijos los
  pagos que se repiten.
- **Presupuesto**
  - *Previsto y real*: ingresos, fijos, variables y ahorro del mes, con la diferencia.
  - *Regla 50/30/20*: necesidades, caprichos y ahorro frente a lo que entra.
  - *Objetivos de ahorro* (vacaciones, colchón para imprevistos...) con lo que hay que apartar
    al mes para llegar a tiempo.
  - Límite mensual para cada gasto variable, con aviso al acercarse.
- **Pareja**: por defecto todo es **de los dos**; si un gasto o ingreso es de uno solo, se elige al
  apuntarlo (o para todo un extracto al importarlo). Los nombres se ponen en *Ajustes* y cada
  móvil indica de quién es, para saber quién apuntó cada cosa. El resumen y los movimientos se
  pueden ver de todo, de lo común o de cada uno.
- **Subir archivos y que se rellene todo solo**
  - **Extracto del banco** en Excel (`.xlsx`, `.xls`, `.ods`), CSV o PDF.
  - **Tickets y facturas** en PDF o foto: lee la tienda, la fecha y el total.
  - Antes de guardar ves una lista para revisar; los movimientos que ya tenías no se duplican.
- **Categorías automáticas** agrupadas en fijos, variables, ahorro e ingresos. Si corriges una,
  la app lo aprende para la próxima vez.
- **Copia de seguridad** en JSON, **exportar a Excel** (CSV) y **datos de ejemplo**.
- **Estilo oscuro o claro**, a elegir en *Ajustes* (cada móvil el suyo; por defecto, oscuro).

Los archivos se leen en el propio móvil u ordenador. La primera vez que abres un Excel, un PDF
o una foto se descarga el lector correspondiente (SheetJS, PDF.js o Tesseract.js); después
funciona sin conexión.

## Conectar con Google Sheets y Drive

Opcional, pero recomendable: así tienes una copia en Google, puedes usar la app en varios
móviles (por ejemplo, los dos de la pareja) y ver o editar los movimientos en una hoja de cálculo.

1. Crea una hoja de cálculo nueva en Google Sheets (por ejemplo "Economía familiar").
2. En la hoja: **Extensiones > Apps Script**. Borra lo que haya y pega el contenido de
   [`Codigo.gs`](Codigo.gs).
3. Guarda la clave en el script: **Configuración del proyecto (⚙) > Propiedades del
   script > Añadir propiedad**, con nombre `TOKEN` y como valor una clave larga
   inventada. No la escribas en el código ni la subas a GitHub: el repositorio es público.
4. Elige la función `configurar` y pulsa **Ejecutar**. Acepta los permisos.
   Se crean las pestañas *Movimientos*, *Gastos fijos*, *Presupuestos*, *Objetivos de ahorro*,
   *Ajustes* y *Reglas*, y en tu Drive la carpeta *Economía familiar - tickets*.
5. **Implementar > Nueva implementación > Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
6. La URL que termina en `/exec` va puesta en la app (`DEFAULT_URL` en `sync.js`).
   Si algún día creas una implementación nueva con otra URL, cámbiala ahí.
7. En la app: **Más > Google Sheets y Drive**, escribe la clave y pulsa
   *Guardar y sincronizar*. Hazlo en cada móvil u ordenador que uses.

### Actualizar el script (cuando cambie `Codigo.gs`)

1. En **Extensiones > Apps Script**, borra el código y pega la versión nueva de `Codigo.gs`
   (la clave sigue guardada en las propiedades del script).
2. Ejecuta otra vez `configurar`: crea las pestañas nuevas y pasa las que ya tenías al formato
   nuevo sin perder datos (las columnas se reconocen por su nombre).
3. **Implementar > Gestionar implementaciones > Editar (lápiz) > Versión: Nueva versión >
   Implementar**. Así la URL sigue siendo la misma y no hay que cambiar nada en la app.

### Cómo funciona

- Cada fila de *Movimientos* es un movimiento: fecha, concepto, categoría, importe (los gastos
  en negativo), tipo (gasto fijo, gasto variable, ahorro o ingreso), quién (*Los dos* o el
  nombre de cada uno) y, si viene de un ticket, el enlace a la foto o el PDF en Drive.
- *Gastos fijos* tiene un recibo por fila: importe, día de cobro, cada cuántos meses llega,
  el primer mes y cómo aparece en el banco (para marcarlo como pagado solo).
- En *Ajustes* están los nombres de los dos (`p1` y `p2`); se cambian desde la app o aquí.
  El importe es un número de verdad, así que puedes hacer sumas, filtros o tablas dinámicas.
- Puedes **corregir o añadir filas a mano** en la hoja. La categoría se elige en un desplegable.
  Si escribes un gasto en positivo se pone en negativo solo. Los cambios llegan a la app en la
  siguiente sincronización.
- *Presupuestos*, *Objetivos de ahorro* y *Reglas* (lo que la app ha aprendido al corregir
  categorías) también se comparten entre los dos móviles y se pueden editar en la hoja.
- Se sincroniza sola unos segundos después de cada cambio, al abrir la app y al volver a ella.
  Si un mismo movimiento se cambia en dos sitios, gana el cambio más reciente.
- Al borrar algo en la app, la fila se marca como *Borrado* (no se elimina, por si acaso)
  y su ticket pasa a la papelera de Drive.
- Con la sincronización activada no aparece *Cargar datos de ejemplo*, para no llenar tu hoja
  de datos inventados.

## Archivos

| Archivo | Qué contiene |
|---|---|
| `index.html`, `styles.css` | Pantalla y estilos (oscuro o claro, se elige en Ajustes) |
| `app.js` | Pantallas, navegación y cálculos |
| `importer.js` | Lectura de CSV, Excel, PDF y fotos (OCR) |
| `categories.js` | Categorías y palabras clave para clasificar |
| `charts.js` | Gráficos en SVG, sin librerías |
| `db.js` | Almacenamiento en el dispositivo (IndexedDB) |
| `sync.js`, `Codigo.gs` | Sincronización con Google Sheets y Drive (app y script de Google) |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Instalación y uso sin conexión |

## Probarla

Cualquier servidor estático sirve:

```sh
python3 -m http.server 8000
# abre http://localhost:8000
```

En la pantalla de inicio pulsa **Cargar datos de ejemplo** para ver los gráficos con datos.

Cuando se publica una versión nueva, basta con cerrar la app y volver a abrirla (con conexión):
se actualiza sola. En *Ajustes > Datos* se ve el número de versión que tiene cada móvil.

Para instalarla en el móvil hay que servirla por HTTPS (con GitHub Pages: *Settings > Pages >
Deploy from a branch*) y elegir "Añadir a pantalla de inicio" en el navegador.

## Próximos pasos propuestos

1. **Reparto entre los dos**: si alguna vez pagáis cosas comunes desde cuentas propias, calcular
   quién ha puesto más y cuánto debe uno al otro (como Tricount o Splitwise).
2. **Avisos**: cuando una categoría pasa del 80 % del presupuesto o llega un recibo más caro
   de lo normal.
3. **Resumen anual** para la declaración de la renta (gastos de colegio, médicos, donativos).
