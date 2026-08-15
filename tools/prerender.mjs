/* ============================================================================
   PRE-RENDER — el sustituto de SSR/SSG/ISR en un sitio de un solo archivo.

   Por qué existe: index.html no usa framework. El catálogo y el quiz se
   pintan con JS en cliente, así que el HTML servido llegaba sin un solo
   producto ni pregunta — invisible para crawlers sin JS.

   Cómo funciona: abre la propia página en Chrome headless, deja que el
   código del sitio renderice, y vuelca el HTML resultante entre marcadores.
   No duplica la lógica de render en ningún sitio: la fuente de verdad
   sigue siendo renderGrid()/renderFinder().

   Idempotente: siempre reemplaza entre <!--PRERENDER:x--> y <!--/PRERENDER:x-->,
   así que correrlo N veces da el mismo resultado.

   Uso:  node tools/prerender.mjs [url]
   ============================================================================ */
import {spawn} from 'child_process';
import {readFileSync, writeFileSync} from 'fs';

const HTML   = 'C:/Users/Andrew/LuisBlades/index.html';
const SRC    = process.argv[2] || 'http://localhost:8801/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT   = 9411;
const sleep  = ms => new Promise(r => setTimeout(r, ms));

const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--window-size=1280,900', '--hide-scrollbars', '--no-first-run', '--mute-audio',
  'about:blank'], {stdio:'ignore'});

let target = null;
for (let i = 0; i < 90 && !target; i++) {
  try {
    const list = await fetch(`http://127.0.0.1:${PORT}/json`).then(r => r.json());
    target = list.find(x => x.type === 'page');
  } catch (_) {}
  if (!target) await sleep(250);
}
if (!target) { proc.kill(); throw new Error('no se pudo abrir Chrome'); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = {}; const pageErrors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
  if (m.method === 'Runtime.exceptionThrown')
    pageErrors.push(((m.params.exceptionDetails.exception || {}).description || 'ex').slice(0, 120));
};
const send = (method, params = {}) => new Promise(res => {
  const i = ++id; pending[i] = res;
  ws.send(JSON.stringify({id: i, method, params}));
});
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true});
  return r.result && r.result.result ? r.result.result.value : undefined;
};

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', {url: SRC});
await sleep(8000);                      // productos cargados + render inicial

/* El grid muestra S.visible tarjetas; para el HTML estático nos basta la
   primera tanda. Se limpian atributos que solo tienen sentido en runtime
   (data-dev lo pone la animación de entrada) para que el HTML servido sea
   el estado "recién pintado", no un estado a medio animar. */
const grabbed = await evaluate(`(()=>{
  const grid = document.getElementById('grid');
  const finder = document.getElementById('finderBox');
  const clean = html => html
      .replace(/\\sdata-dev="1"/g, '')
      .replace(/\\sstyle="[^"]*"/g, '')
      .trim();
  const cards = [...grid.querySelectorAll('.card')].slice(0, 12)
      .map(c => c.outerHTML).join('');
  return {
    grid: clean(cards),
    finder: clean(finder.innerHTML),
    numTarjetas: grid.querySelectorAll('.card').length,
    /* Ojo: nada de acentos graves aqui dentro, esto vive en un template
       literal y lo cerrarian.
       S es un const de nivel superior, no una propiedad de window, asi
       que window.S siempre fue undefined y este campo reportaba 0 aunque
       el catalogo estuviera cargado. Ahora se lee el contador que la
       propia pagina pinta, que es el dato real. */
    totalProductos: ((document.getElementById('resultCount')||{}).textContent||'').trim(),
    tituloQuiz: (finder.querySelector('h3,h4,.fq-q') || {}).textContent || null
  };
})()`);

ws.close(); proc.kill();

if (pageErrors.length) { console.error('Errores en la página:', pageErrors); process.exit(1); }
if (!grabbed || !grabbed.grid || !grabbed.finder) {
  console.error('No se pudo capturar contenido. Capturado:', grabbed);
  process.exit(1);
}

let html = readFileSync(HTML, 'utf8');
const before = html.length;
const inject = (key, payload) => {
  const re = new RegExp(`(<!--PRERENDER:${key}-->)[\\s\\S]*?(<!--/PRERENDER:${key}-->)`);
  if (!re.test(html)) { console.error(`faltan los marcadores PRERENDER:${key}`); process.exit(1); }
  html = html.replace(re, (_, a, b) => a + payload + b);
};
inject('grid', grabbed.grid);
inject('finder', grabbed.finder);
writeFileSync(HTML, html);

console.log(JSON.stringify({
  origen: SRC,
  tarjetasEnGridAlCapturar: grabbed.numTarjetas,
  tarjetasInyectadas: (grabbed.grid.match(/class="card"/g) || []).length,
  productosCargados: grabbed.totalProductos,
  quizCapturado: !!grabbed.finder,
  bytesIndexAntes: before,
  bytesIndexDespues: html.length,
  delta: html.length - before,
  erroresDePagina: pageErrors
}, null, 1));
