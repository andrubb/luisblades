/* =====================================================================
   Blades Privé — fotos del catálogo

   Las 710 fotos NO pueden entrar por el panel de admin: ahí cada foto se
   guarda como texto dentro de localStorage (~5 MB de cuota) y 710 fotos
   comprimidas son 40-70 MB. El panel sirve para un puñado de destacados.

   Lo que sí escala: los archivos viven en el repo, en assets/perfumes/,
   y cada producto encuentra el suyo por un slug de marca + nombre.
   Cuesta cero cuota, se ve igual para todos los visitantes en todos los
   dispositivos, y añadir una foto no toca código.

   USO
     node tools/fotos.mjs lista
         Escribe data/nombres-fotos.txt con los 710 perfumes y el nombre
         EXACTO de archivo que necesita cada uno.

     node tools/fotos.mjs procesar <carpeta>
         Toma las fotos crudas de esa carpeta, las empareja con un
         perfume por su nombre de archivo, las reescala a WebP y las deja
         en assets/perfumes/ con el nombre correcto. Dice cuáles no pudo
         emparejar.

     node tools/fotos.mjs
         Vuelve a escanear assets/perfumes/ y actualiza el manifiesto
         dentro de index.html. Se corre solo al final de "procesar".

   POR QUÉ HAY MANIFIESTO. Si cada producto intentara cargar su archivo a
   ciegas, los cientos que aún no tienen foto dispararían un 404 cada
   uno. El manifiesto es la lista de los que SÍ existen; los demás van
   directos al marcador de posición sin pedir nada.

   Los slugs se los pide a la PROPIA PÁGINA (su función slugFoto), no se
   recalculan aquí: así la herramienta y el sitio no pueden discrepar.
   ===================================================================== */
import {spawn} from 'child_process';
import {createServer} from 'http';
import {readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync} from 'fs';
import {extname, basename, join, resolve} from 'path';

const RAIZ = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const INDEX = join(RAIZ, 'index.html');
const DESTINO = join(RAIZ, 'assets', 'perfumes');
const LISTA = join(RAIZ, 'data', 'nombres-fotos.txt');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const LADO_MAX = 900;     /* el lado mayor; una ficha nunca la muestra más grande */
const CALIDAD = 0.82;
const EXT_OK = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kb = (n) => Math.round(n / 1024) + ' KB';

/* ---------------------------------------------------------------------
   Un servidor mínimo sobre la raíz del repo. La herramienta no debe
   depender de que haya otro corriendo.
   ------------------------------------------------------------------ */
function sirve() {
  const TIPOS = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2'};
  const srv = createServer((req, res) => {
    let ruta = decodeURIComponent(req.url.split('?')[0]);
    if (ruta === '/') ruta = '/index.html';
    const f = join(RAIZ, ruta);
    if (!f.startsWith(RAIZ) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type': TIPOS[extname(f).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'});
    res.end(readFileSync(f));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({srv, puerto: srv.address().port})));
}

/* ---------------------------------------------------------------------
   Chrome sin cabecera, por CDP. Se usa para dos cosas: leer el catálogo
   de la propia página y reescalar imágenes con canvas (aquí no hay
   librerías de imagen instaladas).
   ------------------------------------------------------------------ */
async function abreChrome() {
  const puerto = 9000 + Math.floor(Math.random() * 900);
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + puerto,
    '--window-size=1000,800', '--hide-scrollbars', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
  let t = null;
  for (let i = 0; i < 120 && !t; i++) {
    try {
      const l = await fetch('http://127.0.0.1:' + puerto + '/json').then((r) => r.json());
      t = l.find((x) => x.type === 'page');
    } catch (e) { /* aún no levanta */ }
    if (!t) await sleep(250);
  }
  if (!t) { proc.kill(); throw new Error('no se pudo abrir Chrome'); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const pend = {};
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } };
  const send = (me, pa = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({id: i, method: me, params: pa})); });
  /* con techo: una promesa que no resuelve no puede colgar la herramienta */
  const ev = async (x, ms = 30000) => {
    const r = await Promise.race([
      send('Runtime.evaluate', {expression: x, awaitPromise: true, returnByValue: true}),
      new Promise((res) => setTimeout(() => res({__techo: true}), ms)),
    ]);
    if (r && r.__techo) throw new Error('se agotó la espera evaluando en la página');
    const s = r.result && r.result.result;
    return s ? ('value' in s ? s.value : undefined) : undefined;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return {send, ev, cierra: () => { try { ws.close(); } catch (e) { /* ya cerrado */ } proc.kill(); }};
}

/* Los productos, tal como los ve la página, con SU propio slug. */
async function catalogo() {
  const {srv, puerto} = await sirve();
  const ch = await abreChrome();
  try {
    await ch.send('Page.navigate', {url: 'http://127.0.0.1:' + puerto + '/'});
    const t0 = Date.now();
    let listo = false;
    while (Date.now() - t0 < 40000) {
      listo = await ch.ev('!!(typeof S!=="undefined" && S.products && S.products.length && typeof slugFoto==="function")');
      if (listo) break;
      await sleep(300);
    }
    if (!listo) throw new Error('la página no expuso el catálogo — ¿cambió index.html?');
    const json = await ch.ev(`JSON.stringify(S.products.map(p=>({
      id:p.id, brand:p.brand||'', name:p.name||'', categoria:p.category||'', slug:slugFoto(p)
    })))`);
    return {productos: JSON.parse(json), ch, srv, puerto};
  } catch (e) {
    ch.cierra(); srv.close(); throw e;
  }
}

/* ---------------------------------------------------------------------
   lista — el papel con el que salir a fotografiar
   ------------------------------------------------------------------ */
async function haceLista() {
  const {productos, ch, srv} = await catalogo();
  ch.cierra(); srv.close();

  const yaHay = new Set(archivosPuestos());
  const porMarca = new Map();
  productos.forEach((p) => {
    if (!porMarca.has(p.brand)) porMarca.set(p.brand, []);
    porMarca.get(p.brand).push(p);
  });

  const lineas = [];
  lineas.push('BLADES PRIVÉ — nombres de archivo para las fotos del catálogo');
  lineas.push('');
  lineas.push('Poné cada foto en assets/perfumes/ con EXACTAMENTE el nombre de la');
  lineas.push('izquierda, o dejala en cualquier carpeta con el nombre del perfume y');
  lineas.push('corré:  node tools/fotos.mjs procesar <esa carpeta>');
  lineas.push('');
  lineas.push('[x] = ya tiene foto     [ ] = falta');
  lineas.push('');
  let faltan = 0;
  [...porMarca.keys()].sort((a, b) => a.localeCompare(b, 'es')).forEach((marca) => {
    lineas.push('');
    lineas.push('── ' + marca + ' ' + '─'.repeat(Math.max(0, 60 - marca.length)));
    porMarca.get(marca).sort((a, b) => a.name.localeCompare(b.name, 'es')).forEach((p) => {
      const tiene = yaHay.has(p.slug);
      if (!tiene) faltan++;
      /* Cuando el nombre de archivo es largo, el perfume va en la línea de
         abajo: si no, la columna se descuadra y la lista deja de poder
         leerse de un vistazo, que es justo para lo que sirve. */
      const arch = p.slug + '.webp';
      lineas.push(arch.length > 50
        ? '  [' + (tiene ? 'x' : ' ') + '] ' + arch + '\n' + ' '.repeat(10) + '↳ ' + p.name
        : '  [' + (tiene ? 'x' : ' ') + '] ' + arch.padEnd(52) + p.name);
    });
  });
  lineas.push('');
  lineas.push('');
  lineas.push('TOTAL: ' + productos.length + ' perfumes · ' + (productos.length - faltan) + ' con foto · ' + faltan + ' sin foto');

  mkdirSync(join(RAIZ, 'data'), {recursive: true});
  writeFileSync(LISTA, lineas.join('\n'), 'utf8');
  console.log('lista escrita en  data/nombres-fotos.txt');
  console.log(productos.length + ' perfumes · ' + (productos.length - faltan) + ' con foto · ' + faltan + ' sin foto');
}

/* ---------------------------------------------------------------------
   procesar — de fotos crudas a archivos listos
   ------------------------------------------------------------------ */
const slugDeTexto = (t) => t.toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

async function procesa(carpeta) {
  const dir = resolve(carpeta);
  if (!existsSync(dir)) { console.error('no existe la carpeta: ' + dir); process.exit(1); }
  const entradas = readdirSync(dir).filter((f) => EXT_OK.has(extname(f).toLowerCase()));
  if (!entradas.length) { console.error('no hay imágenes en ' + dir); process.exit(1); }
  console.log(entradas.length + ' imágenes en la carpeta\n');

  const {productos, ch, srv, puerto} = await catalogo();
  mkdirSync(DESTINO, {recursive: true});

  /* índice para emparejar: por slug exacto y por slug del nombre solo */
  const porSlug = new Map();
  const porNombre = new Map();
  productos.forEach((p) => {
    porSlug.set(p.slug, p);
    const sn = slugDeTexto(p.name);
    if (!porNombre.has(sn)) porNombre.set(sn, []);
    porNombre.get(sn).push(p);
  });

  const hechos = []; const sinPareja = []; const ambiguos = [];
  try {
    for (const nombre of entradas) {
      const base = slugDeTexto(basename(nombre, extname(nombre)));
      let p = porSlug.get(base);
      if (!p) {
        /* sin marca en el nombre del archivo: se busca por nombre solo */
        const cand = porNombre.get(base) || [];
        if (cand.length === 1) p = cand[0];
        else if (cand.length > 1) { ambiguos.push({nombre, cand}); continue; }
      }
      if (!p) { sinPareja.push(nombre); continue; }

      const bytes = readFileSync(join(dir, nombre));
      const b64 = bytes.toString('base64');
      const tipo = extname(nombre).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
      const salida = await ch.ev(`(async()=>{
        const im=new Image();
        im.src='data:${tipo};base64,${b64}';
        await im.decode();
        const w=im.naturalWidth, h=im.naturalHeight;
        const f=Math.min(1, ${LADO_MAX}/Math.max(w,h));
        const c=document.createElement('canvas');
        c.width=Math.max(1,Math.round(w*f)); c.height=Math.max(1,Math.round(h*f));
        const g=c.getContext('2d');
        g.imageSmoothingQuality='high';
        g.drawImage(im,0,0,c.width,c.height);
        return JSON.stringify({w,h,cw:c.width,ch:c.height,src:c.toDataURL('image/webp',${CALIDAD})});
      })()`, 60000);
      const r = JSON.parse(salida);
      const buf = Buffer.from(r.src.split(',')[1], 'base64');
      writeFileSync(join(DESTINO, p.slug + '.webp'), buf);
      hechos.push({nombre, slug: p.slug, de: r.w + 'x' + r.h, a: r.cw + 'x' + r.ch,
        antes: bytes.length, despues: buf.length, perfume: p.brand + ' · ' + p.name});
      console.log('  ✓ ' + nombre.padEnd(38).slice(0, 38) + ' → ' + (p.slug + '.webp').padEnd(44).slice(0, 44) +
        r.w + 'x' + r.h + ' → ' + r.cw + 'x' + r.ch + '  ' + kb(bytes.length) + ' → ' + kb(buf.length));
    }
  } finally { ch.cierra(); srv.close(); }

  console.log('');
  if (sinPareja.length) {
    console.log('SIN PAREJA (' + sinPareja.length + ') — el nombre del archivo no coincide con ningún perfume:');
    sinPareja.forEach((f) => console.log('    ' + f));
    console.log('    Mirá data/nombres-fotos.txt para el nombre exacto de cada uno.');
    console.log('');
  }
  if (ambiguos.length) {
    /* Se listan los nombres de archivo CANDIDATOS, no las marcas: cuando
       las variantes son de la misma casa (Acqua di Gio de dama y de
       caballero) repetir la marca tres veces no dice nada. Con el slug
       delante, renombrar es copiar y pegar. */
    console.log('AMBIGUOS (' + ambiguos.length + ') — ese nombre lo tienen varias variantes.');
    console.log('Renombrá el archivo con uno de estos nombres exactos:');
    ambiguos.forEach((a) => {
      console.log('    ' + a.nombre);
      [...new Set(a.cand.map((c) => c.slug))].forEach((sl) => console.log('        ' + sl + '.webp'));
    });
    console.log('');
  }
  const ahorro = hechos.reduce((s, h) => s + (h.antes - h.despues), 0);
  console.log(hechos.length + ' fotos colocadas · ' + kb(ahorro) + ' ahorrados al reescalar');
  await actualizaManifiesto();
}

/* ---------------------------------------------------------------------
   manifiesto — la lista de slugs que SÍ tienen archivo
   ------------------------------------------------------------------ */
function archivosPuestos() {
  if (!existsSync(DESTINO)) return [];
  return readdirSync(DESTINO)
    .filter((f) => extname(f).toLowerCase() === '.webp')
    .map((f) => basename(f, '.webp'))
    .sort();
}

async function actualizaManifiesto() {
  const slugs = archivosPuestos();
  let s = readFileSync(INDEX, 'utf8');
  const eraCRLF = s.includes('\r\n');
  if (eraCRLF) s = s.split('\r\n').join('\n');

  const ini = s.indexOf('   INICIO-FOTOS */');
  const fin = s.indexOf('/* FIN-FOTOS */');
  if (ini < 0 || fin < 0) {
    console.error('no encuentro las marcas INICIO-FOTOS / FIN-FOTOS en index.html');
    process.exit(1);
  }
  const desde = s.indexOf('\n', ini) + 1;
  /* en varias líneas para que el diff sea legible cuando crezca */
  const cuerpo = slugs.length
    ? 'const FOTOS = new Set([\n' +
      slugs.map((x) => "  '" + x + "',").join('\n') +
      '\n]);\n'
    : 'const FOTOS = new Set([]);\n';
  s = s.slice(0, desde) + cuerpo + s.slice(fin);

  if (eraCRLF) s = s.split('\n').join('\r\n');
  writeFileSync(INDEX, s, 'utf8');
  console.log('manifiesto actualizado: ' + slugs.length + ' fotos en assets/perfumes/');
}

/* ------------------------------------------------------------------ */
const [, , cmd, arg] = process.argv;
try {
  if (cmd === 'lista') await haceLista();
  else if (cmd === 'procesar') {
    if (!arg) { console.error('falta la carpeta:  node tools/fotos.mjs procesar <carpeta>'); process.exit(1); }
    await procesa(arg);
  } else if (!cmd) await actualizaManifiesto();
  else {
    console.log('uso:');
    console.log('  node tools/fotos.mjs lista               la lista de nombres que hace falta');
    console.log('  node tools/fotos.mjs procesar <carpeta>  convierte y coloca las fotos');
    console.log('  node tools/fotos.mjs                     reescanea y actualiza el manifiesto');
    process.exit(1);
  }
} catch (e) {
  console.error('ERROR: ' + e.message);
  process.exit(1);
}
