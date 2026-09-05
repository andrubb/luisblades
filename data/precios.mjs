/* LOS PRECIOS NO LOS PUEDO INVENTAR.

   675 de 705 fragancias no tienen precio, y no es que se hayan perdido:
   no estan en ningun sitio. Lo comprobe en data/raw-inventory.txt, que
   es la lista original de la que salio todo, y ahi solo hay marca,
   nombre, concentracion, tamano y genero. Ninguna cifra.

   Inventarme un precio de perfume seria fabricar datos de un negocio
   real. Asi que lo que hago es lo otro: que ponerlos cueste lo menos
   posible.

   Sale una hoja de calculo con una fila por fragancia, ordenada por
   marca y con todo lo que Luis necesita para reconocerla —tamano y
   concentracion incluidos, que es justo lo que distingue un Acqua di
   Gio de 100 de uno de 200—. El solo escribe numeros en la ultima
   columna. Lo que deje vacio se queda como "Consultar", que es un
   estado perfectamente valido: no hace falta llenarla entera para
   lanzar.

   Con `node precios.mjs cargar` vuelve a entrar. */
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';

const RAIZ = 'C:/Users/Andrew/LuisBlades';
const HOJA = RAIZ + '/data/precios.csv';
const cargar = process.argv[2] === 'cargar';

const cat = JSON.parse(await fs.readFile(RAIZ + '/data/catalog-completo.json', 'utf-8'));

/* Excel en español abre bien el punto y coma; la coma le hace un lio con
   los decimales. Y el BOM es lo que evita que "Privé" salga como "PrivÃ©". */
const SEP = ';';
const escapa = v => { const s = String(v == null ? '' : v);
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

if (!cargar) {
  const filas = [...cat].sort((a, b) =>
    (a.brand || '').localeCompare(b.brand || '', 'es') ||
    (a.name || '').localeCompare(b.name || '', 'es') ||
    (a.size_ml || 0) - (b.size_ml || 0));

  const cab = ['id', 'marca', 'nombre', 'tamano', 'concentracion', 'genero', 'categoria', 'precio_crc'];
  const cuerpo = filas.map(p => [
    p.id, p.brand, p.name,
    p.size_ml ? p.size_ml + ' ml' : (p.size_g ? p.size_g + ' g' : ''),
    p.concentration || '', p.gender || '', p.category || '',
    p.price_crc == null ? '' : p.price_crc,
  ].map(escapa).join(SEP));

  await fs.writeFile(HOJA, '\uFEFF' + [cab.join(SEP), ...cuerpo].join('\r\n') + '\r\n', 'utf-8');
  console.log('-> data/precios.csv   ' + filas.length + ' filas');
  console.log('   ya con precio : ' + cat.filter(p => p.price_crc != null).length);
  console.log('   por poner     : ' + cat.filter(p => p.price_crc == null).length);
  console.log('');
  console.log('   Abrila en Excel o Google Sheets, escribi los numeros en la');
  console.log('   ultima columna (sin ₡ ni puntos: 85000) y guardala igual.');
  console.log('   Despues:  node data/precios.mjs cargar');
  process.exit(0);
}

// ---------- volver a entrar ----------
if (!existsSync(HOJA)) { console.error('No encuentro data/precios.csv'); process.exit(1); }
let txt = await fs.readFile(HOJA, 'utf-8');
if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
const lineas = txt.split(/\r?\n/).filter(l => l.trim());
const cabecera = lineas.shift().split(SEP);
const iId = cabecera.indexOf('id'), iPre = cabecera.indexOf('precio_crc');
if (iId < 0 || iPre < 0) { console.error('La hoja no tiene las columnas id y precio_crc'); process.exit(1); }

/* un parseador de CSV pequeno pero correcto: los nombres llevan comillas
   y puntos y comas dentro */
function corta(l) { const out = []; let cur = '', dentro = false;
  for (let i = 0; i < l.length; i++) { const c = l[i];
    if (dentro) { if (c === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else dentro = false; } else cur += c; }
    else if (c === '"') dentro = true;
    else if (c === SEP) { out.push(cur); cur = ''; }
    else cur += c; }
  out.push(cur); return out; }

const nuevos = new Map();
let raros = 0;
for (const l of lineas) {
  const c = corta(l);
  const id = +c[iId];
  const bruto = (c[iPre] || '').trim().replace(/[₡\s.]/g, '').replace(',', '.');
  if (!id || !bruto) continue;
  const n = Number(bruto);
  if (!isFinite(n) || n <= 0) { raros++; continue; }
  nuevos.set(id, Math.round(n));
}
console.log('precios leidos de la hoja: ' + nuevos.size + (raros ? '   (' + raros + ' celdas ilegibles, saltadas)' : ''));

let cambios = 0;
for (const p of cat) { const n = nuevos.get(p.id);
  if (n != null && n !== p.price_crc) { p.price_crc = n; cambios++; } }
await fs.writeFile(RAIZ + '/data/catalog-completo.json', JSON.stringify(cat, null, 1));
console.log('precios cambiados en data/catalog-completo.json: ' + cambios);
console.log('siguen sin precio: ' + cat.filter(p => p.price_crc == null).length);
console.log('');
console.log('Eso deja el archivo listo para migrar a Supabase.');
console.log('Si el sitio todavia NO lee de Supabase, los precios hay que');
console.log('ponerlos tambien en el panel, o migrar primero.');
