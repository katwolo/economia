# Economía familiar

App para llevar las cuentas de casa, instalable en el móvil (PWA) y que funciona sin conexión.
Sigue la misma idea que *Notes*: todo se guarda primero en el dispositivo (IndexedDB) y no
hace falta crear ninguna cuenta.

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

Los archivos se leen en el propio móvil u ordenador: no se envían a ningún servidor. La primera
vez que abres un Excel, un PDF o una foto se descarga el lector correspondiente
(SheetJS, PDF.js o Tesseract.js); después funciona sin conexión.

## Archivos

| Archivo | Qué contiene |
|---|---|
| `index.html`, `styles.css` | Pantalla y estilos (modo claro y oscuro automáticos) |
| `app.js` | Pantallas, navegación y cálculos |
| `importer.js` | Lectura de CSV, Excel, PDF y fotos (OCR) |
| `categories.js` | Categorías y palabras clave para clasificar |
| `charts.js` | Gráficos en SVG, sin librerías |
| `db.js` | Almacenamiento en el dispositivo (IndexedDB) |
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

1. **Sincronizar con Google Sheets y Drive**, como en *Notes*: cada movimiento sería una fila
   de una hoja (*Movimientos*, *Presupuestos*) y los tickets se guardarían en una carpeta de
   Drive. Así la pareja o la familia ven lo mismo desde varios móviles.
2. **Varias cuentas o personas** (cuenta común, tarjeta de cada uno) con filtro en el resumen.
3. **Objetivos de ahorro** (vacaciones, colchón de emergencia) con barra de progreso.
4. **Avisos**: cuando una categoría pasa del 80 % del presupuesto o llega un recibo más caro
   de lo normal.
5. **Resumen anual** para la declaración de la renta (gastos de colegio, médicos, donativos).
