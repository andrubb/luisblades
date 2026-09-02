import fs from 'node:fs/promises';
import path from 'node:path';

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const INPUT_FILE = process.argv[2] || './products.json';
const OUTPUT_DIR = './public/product-images';
const DELAY_MS = 300;

if (!SERPER_API_KEY) {
  console.error('Falta SERPER_API_KEY. Corré: export SERPER_API_KEY="tu_key"');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchImage(query) {
  const res = await fetch('https://google.serper.dev/images', {
    method: 'POST',
    headers: {
      'X-API-KEY': SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: 5 }),
  });
  if (!res.ok) throw new Error(`Serper error ${res.status}`);
  const data = await res.json();
  return data.images?.[0]?.imageUrl || null;
}

async function downloadImage(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download error ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buf);
}

async function main() {
  const raw = await fs.readFile(INPUT_FILE, 'utf-8');
  const products = JSON.parse(raw);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const results = [];
  for (const [i, p] of products.entries()) {
    const query = `${p.brand} ${p.name} ${p.concentration || ''} ${p.gender || ''} perfume bottle official`.replace(/\s+/g, ' ').trim();
    const fileName = `${p.id}.jpg`;
    const destPath = path.join(OUTPUT_DIR, fileName);

    try {
      const imageUrl = await searchImage(query);
      if (!imageUrl) {
        console.warn(`[${i + 1}/${products.length}] Sin resultado: ${query}`);
        results.push({ id: p.id, status: 'not_found' });
        continue;
      }
      await downloadImage(imageUrl, destPath);
      console.log(`[${i + 1}/${products.length}] OK: ${p.brand} ${p.name}`);
      results.push({
        id: p.id,
        status: 'ok',
        localPath: `/product-images/${fileName}`,
        source: imageUrl,
      });
    } catch (err) {
      console.error(`[${i + 1}/${products.length}] Error en "${query}": ${err.message}`);
      results.push({ id: p.id, status: 'error', error: err.message });
    }

    await sleep(DELAY_MS);
  }

  await fs.writeFile('./image-map.json', JSON.stringify(results, null, 2));
  const ok = results.filter((r) => r.status === 'ok').length;
  console.log(`\nListo: ${ok}/${products.length} imágenes descargadas. Ver image-map.json para el detalle.`);
}

main();
