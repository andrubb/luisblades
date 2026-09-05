/* =====================================================================
   Blades Privé — ONE-TIME catalog migration into Supabase `perfumes`.
   Reads data/catalog-parsed.json (produced by parse-inventory.mjs).

   RUN:
     SUPABASE_URL=https://qpqlacqwdkcpavaixpyj.supabase.co \
     SUPABASE_SERVICE_KEY=<service_role key>  node data/migrate-to-supabase.mjs
     (add --dry to preview without writing)

   NOTE: as of this commit the project's anon key is still the literal
   placeholder REPLACE_WITH_YOUR_SUPABASE_ANON_KEY and the REST endpoint
   answers 401 "No API key found in request", so this has NOT been run.
   It is idempotent (upsert on id) and safe to re-run once a key exists.

   SCHEMA COLUMNS REQUIRED (add before first run if missing):
     concentration text, size_ml numeric, size_g numeric, gender text,
     featured_note_es text, featured_note_en text
   -> el SQL listo esta en data/01-columnas.sql
   Existing columns used: id, brand, name, category, price_crc, family,
     intensity, longevity, sillage, is_bestseller, in_stock, is_featured,
     occasions, seasons, top_notes, heart_notes, base_notes,
     description_es, description_en, image_url
   ===================================================================== */
import {readFileSync} from 'fs';

const SB_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const DRY = process.argv.includes('--dry');
const TABLE = 'perfumes';
const BATCH = 100;

if(!SB_URL || !KEY){
  console.error('ABORT: set SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY).');
  console.error('       Nothing was written.');
  process.exit(1);
}

/* catalog-parsed.json son 680: solo el inventario importado. El sitio
   muestra 710, porque suma las 30 escritas a mano —las estrella, las que
   llevan nota del curador—. Migrar el archivo de 680 habria dejado
   Supabase sin esas 30, y en cuanto el sitio leyera de ahi habrian
   desaparecido del catalogo. catalog-completo.json es PERFUMES + IMPORTED tal
   y como los ve la pagina. */
const rows = JSON.parse(readFileSync(new globalThis.URL('./catalog-completo.json', import.meta.url), 'utf8'))
  .map(({source_line, ...r}) => r);          // source_line is audit-only, not a column

/* Y si algun dia vuelve a descuadrar, que se pare aqui y no a mitad de
   la escritura. */
const ESPERADAS = 705;   // 30 curadas + 675 importadas, sin las 5 filas repetidas
if (rows.length !== ESPERADAS) {
  console.error(`ABORT: catalog-completo.json tiene ${rows.length} filas y se esperaban ${ESPERADAS}.`);
  console.error('       Regenera el archivo antes de migrar. No se escribio nada.');
  process.exit(1);
}

console.log(`rows to upsert: ${rows.length}  (dry-run: ${DRY})`);
if(DRY){ console.log(JSON.stringify(rows.slice(0,3),null,1)); process.exit(0); }

let ok=0, fail=0;
for(let i=0;i<rows.length;i+=BATCH){
  const chunk = rows.slice(i, i+BATCH);
  const res = await fetch(`${SB_URL}/rest/v1/${TABLE}?on_conflict=id`,{
    method:'POST',
    headers:{
      'apikey':KEY, 'Authorization':`Bearer ${KEY}`,
      'Content-Type':'application/json',
      'Prefer':'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(chunk)
  });
  if(res.ok){ ok+=chunk.length; console.log(`  batch ${i/BATCH+1}: ${chunk.length} ok`); }
  else { fail+=chunk.length; console.error(`  batch ${i/BATCH+1} FAILED ${res.status}: ${(await res.text()).slice(0,200)}`); }
}
console.log(`\nupserted: ${ok}   failed: ${fail}`);
process.exit(fail?1:0);
