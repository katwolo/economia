# Economía familiar

App para llevar las cuentas de casa, instalable en el móvil (PWA) y que funciona sin conexión.
Sigue la misma idea que *Notes*: todo se guarda primero en el dispositivo (IndexedDB), así que
no necesita internet, y si conectas Google se sincroniza con una hoja de cálculo y una carpeta
de Drive.

## Qué hace

- **Resumen del mes**: lo que entra, lo que sale y lo que te queda, en grande y con frases
  claras ("Ahorras el 54 % de lo que entra").
- **Gráficos**
  - Ingresos y gastos de los últimos 6 meses (toca una barra para ver el detalle).
  - ¿En qué se va el dinero? Gasto por categoría, de mayor a menor. Toca una categoría para
    ver sus movimientos.
  - Presupuestos con barra de progreso: *Vas bien*, *Cerca del límite* o *Te has pasado*.
- **Subir archivos y que se rellene todo solo**
  - **Extracto del banco** en Excel (`.xlsx`, `.xls`, `.ods`), CSV o PDF: reconoce las columnas
    de fecha, concepto e importe (o cargo/abono) de la mayoría de bancos españoles.
  - **Tickets y facturas** en PDF o foto: lee la tienda, la fecha y el total y te deja el
    formulario ya rellenado para revisarlo.
  - Antes de guardar ves una lista para revisar; los movimientos que ya tenías se marcan
    como *ya está* y no se duplican.
- **Categorías automáticas**: Mercadona → Supermercado, Endesa → Luz, Netflix →
  Suscripciones... Si corriges una, la app lo aprende para la próxima vez
  (lo puedes ver y borrar en *Más*).
- **Gastos fijos**: detecta los recibos que se repiten cada mes (hipoteca, luz, seguros,
  suscripciones) y suma cuánto suponen.
- **Presupuestos** por categoría, con la media de los 3 meses anteriores como referencia.
- **Movimientos**: lista por días, buscador y filtros (gastos / ingresos / categoría).
- **Copia de seguridad** en JSON, **exportar a Excel** (CSV) y **datos de ejemplo** para
  probarla sin meter nada tuyo.

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
   Se crean las pestañas *Movimientos*, *Presupuestos* y *Reglas*, y en tu Drive la carpeta
   *Economía familiar - tickets*.
5. **Implementar > Nueva implementación > Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
6. La URL que termina en `/exec` va puesta en la app (`DEFAULT_URL` en `sync.js`).
   Si algún día creas una implementación nueva con otra URL, cámbiala ahí.
7. En la app: **Más > Google Sheets y Drive**, escribe la clave y pulsa
   *Guardar y sincronizar*. Hazlo en cada móvil u ordenador que uses.

Si cambias `Codigo.gs` más adelante, pega la versión nueva (la clave sigue guardada en
las propiedades del script) y usa **Implementar > Gestionar implementaciones >
Editar > Nueva versión** para que la URL siga siendo la misma.

### Cómo funciona

- Cada fila de *Movimientos* es un movimiento: fecha, concepto, categoría, importe (los gastos
  en negativo) y, si viene de un ticket, el enlace a la foto o el PDF en Drive.
  El importe es un número de verdad, así que puedes hacer sumas, filtros o tablas dinámicas.
- Puedes **corregir o añadir filas a mano** en la hoja. La categoría se elige en un desplegable.
  Si escribes un gasto en positivo se pone en negativo solo. Los cambios llegan a la app en la
  siguiente sincronización.
- *Presupuestos* y *Reglas* (lo que la app ha aprendido al corregir categorías) también se
  comparten entre dispositivos y se pueden editar en la hoja.
- Se sincroniza sola unos segundos después de cada cambio, al abrir la app y al volver a ella.
  Si un mismo movimiento se cambia en dos sitios, gana el cambio más reciente.
- Al borrar algo en la app, la fila se marca como *Borrado* (no se elimina, por si acaso)
  y su ticket pasa a la papelera de Drive.
- Con la sincronización activada no aparece *Cargar datos de ejemplo*, para no llenar tu hoja
  de datos inventados.

## Archivos

| Archivo | Qué contiene |
|---|---|
| `index.html`, `styles.css` | Pantalla y estilos (modo claro y oscuro automáticos) |
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

Para instalarla en el móvil hay que servirla por HTTPS (con GitHub Pages: *Settings > Pages >
Deploy from a branch*) y elegir "Añadir a pantalla de inicio" en el navegador.

## Próximos pasos propuestos

1. **Varias cuentas o personas** (cuenta común, tarjeta de cada uno) con filtro en el resumen.
2. **Objetivos de ahorro** (vacaciones, colchón de emergencia) con barra de progreso.
3. **Avisos**: cuando una categoría pasa del 80 % del presupuesto o llega un recibo más caro
   de lo normal.
4. **Resumen anual** para la declaración de la renta (gastos de colegio, médicos, donativos).
