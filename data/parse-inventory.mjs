/* =====================================================================
   Blades Privé — inventory parser (one-time, auditable)
   Reads data/raw-inventory.txt, emits data/catalog-parsed.json + data/flagged.json
   NO invented data: every field is derived from the source line or left null.
   ===================================================================== */
import {readFileSync, writeFileSync} from 'fs';

const RAW = 'C:/Users/Andrew/LuisBlades/data/raw-inventory.txt';
const OUT = 'C:/Users/Andrew/LuisBlades/data/catalog-parsed.json';
const FLG = 'C:/Users/Andrew/LuisBlades/data/flagged.json';

/* ---- brand table. patterns are matched LONGEST-FIRST on the lowercased line ---- */
const BRANDS = [
  ['Ralph Lauren',        ['ralph lauren']],
  ['Rasasi',              ['rasasi']],
  ['Rave Now',            ['rave now']],
  ['Rayhaan',             ['rayhaan']],
  ['Giorgio Beverly Hills',['giorgio beverly hills']],       // NOT in category map -> flagged
  ['Giorgio Armani',      ['giorgio armani','giogio armani']], // OCR: Giogio
  ['Giovanni Bacci',      ['giovanni bacci']],
  ['Givenchy',            ['givenchy']],
  ['Dior',                ['christian dior','dior']],
  ['Casamorati',          ['casamorati']],
  ['Chanel',              ['chanel']],
  ['Clinique',            ['clinique']],
  ['Clive Christian',     ['clive christian']],
  ['Mancera',             ['mancera']],
  ['Antonio Banderas',    ['antonio banderas']],
  ['Acqua Di Parma',      ['acqua di parma','aqua di parma']],
  ['Ariana Grande',       ['ariana grande']],
  ['Dolce & Gabbana',     ['dolce & gabbana','dolce and gabbana','dolce gabbana']],
  ['Montale',             ['montale']],
  ['Mont Blanc',          ['mont blanc','montblanc']],
  ['Monti',               ['monti']],                          // unmapped -> flagged
  ['Moschino',            ['moschino']],
  ['Hermes',              ['hermes']],                          // unmapped -> flagged
  ['Holister',            ['holister']],
  ['Homerun Sports',      ['homerun sports']],
  ['Hugo Boss',           ['hugo boss']],
  ['Initio',              ['initio']],
  ['Paco Rabanne',        ['paco rabanne']],
  ['Pacoroca',            ['pacoroca']],
  ['Palquis',             ['palquis']],
  ['Parfums De Marly',    ['parfums de marly']],
  ['Bond No.9',           ['bond no.9','bond no 9','bond n.9','bond n9','bond']],
  ['Bora Bora',           ['bora bora']],                       // unmapped -> flagged
  ['Born in France',      ['born in france']],                  // unmapped -> flagged
  ['Boston Red Sox',      ['boston red sox']],
  ['Cristiano Ronaldo',   ['boxer cristiano ronaldo','cristiano ronaldo']],
  ['Britney Spears',      ['britney spears']],
  ['Bubble Bath',         ['bubble bath']],
  ['Burberry',            ['burberry']],
  ['Creed',               ['creed']],
  ['Armaf',               ['armaf','armat']],                   // OCR: Armat -> Armaf
  ['Prada',               ['prada']],
  ['Nishane',             ['nishane']],
  ['Al Haramain',         ['al haramain']],
  ['Carolina Herrera',    ['carolina herrera']],
  ['Jo Malone',           ['jo malone']],
  ['Jo Milano',           ['jo milano']],
  ['Lattafa',             ['lattafa']],
  ['Gucci',               ['gucci']],
  ['Afnan',               ['afnan']],
  ['Bvlgari',             ['bvlgari']],
];
const PATTERNS = BRANDS.flatMap(([b,ps])=>ps.map(p=>({brand:b,pat:p})))
                       .sort((a,b)=>b.pat.length-a.pat.length);

/* ---- category map, exactly as specified. anything else = flag, never guess ---- */
const CAT = {};
'Rasasi,Lattafa,Afnan,Al Haramain,Armaf'.split(',').forEach(b=>CAT[b]='Arabic');
'Creed,Parfums De Marly,Nishane,Jo Malone,Montale,Mancera,Initio,Bond No.9,Casamorati,Clive Christian,Acqua Di Parma,Jo Milano'.split(',').forEach(b=>CAT[b]='Niche');
['Ralph Lauren','Giorgio Armani','Dior','Chanel','Dolce & Gabbana','Hugo Boss','Paco Rabanne','Prada',
 'Carolina Herrera','Burberry','Bvlgari','Givenchy','Gucci','Ariana Grande','Britney Spears','Antonio Banderas',
 'Clinique','Moschino','Mont Blanc','Rave Now','Rayhaan','Homerun Sports','Holister','Palquis','Boston Red Sox',
 'Cristiano Ronaldo','Bubble Bath','Giovanni Bacci','Pacoroca'].forEach(b=>CAT[b]='Designer');

/* ---- concentration, longest/most-specific first ---- */
const CONC = [
  [/\bextrait\s+de\s+parfum\b/i,   'Extrait de Parfum'],
  [/\beau\s+de\s+toilette\b/i,     'EDT'],
  [/\beau\s+de\s+parfum\b/i,       'EDP'],
  [/\bbody\s+spray\b/i,            'Body Spray'],
  [/\bconce?[nt]trated\s+oil\b/i,  'Concentrated Oil'],
  [/\bhair\s+mist\b/i,             'Hair Mist'],
  [/\bhair\s+styling\b/i,          'Hair Styling'],
  [/\bdeorant\s+parfume\b/i,       'Deodorant'],
  [/\bdeodorant\b|\bdeorant\b|\bdeo\b/i,'Deodorant'],
  [/\bcologne\b|\bedc\b/i,         'Cologne'],
  [/\belixir\s+de\s+parfum\b/i,    'Parfum'],
  [/\bparfum\b/i,                  'Parfum'],
  [/\bedp\b/i,                     'EDP'],
  [/\bedt\b/i,                     'EDT'],
];
const GENDER = [
  [/\bunisex\b/i,'Unisex'],
  [/\bkids\b/i,'Unisex'],                                   // noted in report
  [/\b(?:lady|mujer|dama|woman|women)\b/i,'Lady'],
  [/\bpour\s+femme\b|\bfor\s+her\b|\bfemme\b/i,'Lady'],
  [/\b(?:men|man|mens|hombre)\b/i,'Men'],
  [/\bpour\s+homme\b|\bfor\s+men\b/i,'Men'],
];
const SIZE = /(\d+(?:\.\d+)?)\s*ml\b/i;
const WEIGHT = /(\d+(?:\.\d+)?)\s*g\b/i;

const titleCase = s => s.split(/\s+/).map(w=>{
  if(!w) return w;
  if(/^\d/.test(w)) return w;                                  // 212, 2.0, 9pm, 1505
  if(/^[A-Z0-9.&'/-]+$/.test(w) && w.length<=5) return w;      // XS, CH, NY, IV, IX, REM, CR7
  if(/[A-Z]/.test(w.slice(1))) return w;                       // FiDi, TriBeCa, LaYuqawam
  return w.charAt(0).toUpperCase()+w.slice(1).toLowerCase();
}).join(' ');

const clean = s => s.replace(/\s+/g,' ')
  .replace(/^[\s\-–—,.:/]+|[\s\-–—,.:/]+$/g,'')
  .replace(/\(\s*\)/g,'').replace(/\s+/g,' ').trim();

const lines = readFileSync(RAW,'utf8').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);

const products=[], flagged=[], notes={noConc:[],noSize:[],noGender:[],kids:[],brandAsName:[]};
let id = 1000;                                                  // imported ids start at 1000

for(const line of lines){
  // --- multi-format lines become distinct SKUs (spec: hair mist / oil / styling) ---
  const parts = line.includes(' / ') ? line.split(' / ').map(p=>p.trim()) : [line];
  let inherited = null;

  for(let pi=0; pi<parts.length; pi++){
    const part = parts[pi];
    const low  = ' '+part.toLowerCase()+' ';

    // brand (inherit for trailing fragments of a multi-format line)
    let hit = PATTERNS.find(p=>low.includes(' '+p.pat+' ')||low.startsWith(' '+p.pat));
    let brand = hit ? hit.brand : (pi>0 && inherited ? inherited.brand : null);

    if(!brand){
      flagged.push({line:part, reason:'no recognizable brand'});
      continue;
    }
    if(pi===0) inherited = {brand};

    let rest = part;
    if(hit){ rest = rest.replace(new RegExp(hit.pat.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'),' '); }

    // concentration
    let concentration=null;
    for(const [re,val] of CONC){ if(re.test(rest)){ concentration=val; rest=rest.replace(re,' '); break; } }
    for(const [re] of CONC){ rest=rest.replace(re,' '); }        // strip any remaining conc tokens

    // size (ml) or weight (g, for deo/styling SKUs)
    let size_ml=null, size_g=null;
    const ms=rest.match(SIZE); if(ms){ size_ml=parseFloat(ms[1]); rest=rest.replace(SIZE,' '); }
    const mg=rest.match(WEIGHT); if(!size_ml&&mg){ size_g=parseFloat(mg[1]); rest=rest.replace(WEIGHT,' '); }

    // gender. NOTE: "pour homme"/"femme" is both a gender signal AND part of real product
    // names (Givenchy Pour Homme, Hugo Boss Femme). Detect gender from it, but recover the
    // name if stripping empties the line; finally fall back to brand-as-product
    // (Boston Red Sox, Bora Bora, Homerun Sports are sold under the brand name alone).
    let gender=null;
    for(const [re,val] of GENDER){ if(re.test(rest)){ gender=val; break; } }
    if(/\bkids\b/i.test(part)) notes.kids.push(part);
    const preStrip = rest;
    for(const [re] of GENDER){ rest=rest.replace(new RegExp(re.source,'gi'),' '); }
    rest = rest.replace(/\bspray\b|\brefillable\b|\brecharge\b|\brefill\b|\bvial\b/gi,' ');

    let name = clean(rest);
    if(!name){                                   // recover "Pour Homme" / "Femme" style names
      name = clean(preStrip.replace(/\b(?:men|man|mens|hombre|lady|mujer|dama|woman|women|unisex|kids)\b/gi,' ')
                           .replace(/\bfor\b\s*$/i,' '));
    }
    if(!name){ name = brand; notes.brandAsName.push(part); }   // brand IS the product
    if(pi>0 && inherited && !name) name = inherited.name;        // "Deo 75G" inherits the product name
    if(pi>0 && inherited && name && concentration) name = inherited.name;

    if(!name){ flagged.push({line:part, reason:'no product name after parsing'}); continue; }
    name = titleCase(name);
    if(pi===0) inherited.name = name;

    const category = CAT[brand] || null;
    if(!category){ flagged.push({line:part, brand, reason:'brand not in category mapping — needs manual category'}); continue; }
    if(!size_ml && !size_g && !concentration){
      flagged.push({line:part, brand, reason:'no size and no concentration — unidentifiable SKU'}); continue;
    }
    if(!concentration) notes.noConc.push(part);
    if(!size_ml && !size_g) notes.noSize.push(part);
    if(!gender) notes.noGender.push(part);

    products.push({
      id: ++id, brand, name, concentration, size_ml, size_g: size_g||null, gender,
      category, price_crc: null,
      // render-safe defaults so cards/modal never throw on imported rows
      family:null, intensity:0, longevity:0, sillage:0,
      is_bestseller:false, in_stock:true, is_featured:false,
      occasions:[], seasons:[], top_notes:[], heart_notes:[], base_notes:[],
      description_es:'', description_en:'',
      image_url:'',                       // '' => existing placeholder silhouette
      source_line: part
    });
  }
}

/* ---- duplicate detection: flag, never merge. different size = NOT a duplicate ---- */
const seen=new Map(), dupes=[];
for(const p of products){
  const key=[p.brand,p.name.toLowerCase(),p.concentration||'-',p.size_ml||p.size_g||'-',p.gender||'-'].join('|');
  if(seen.has(key)) dupes.push({key, lines:[seen.get(key).source_line, p.source_line]});
  else seen.set(key,p);
}
// near-duplicates: identical brand+name+size, differing only by gender/concentration presence
const near=[], byBase=new Map();
for(const p of products){
  const base=[p.brand,p.name.toLowerCase(),p.size_ml||p.size_g||'-'].join('|');
  if(!byBase.has(base)) byBase.set(base,[]);
  byBase.get(base).push(p);
}
for(const [base,arr] of byBase){ if(arr.length>1 && !dupes.some(d=>d.key.startsWith(base.split('|').slice(0,2).join('|')))){
  const uniq=new Set(arr.map(a=>(a.gender||'-')+'/'+(a.concentration||'-')));
  if(uniq.size>1) near.push({base, variants:arr.map(a=>a.source_line)});
}}

writeFileSync(OUT, JSON.stringify(products,null,1));
writeFileSync(FLG, JSON.stringify({flagged,dupes,near,notes},null,1));

const byCat=c=>products.filter(p=>p.category===c).length;
console.log('RAW LINES              :', lines.length);
console.log('PRODUCTS PARSED        :', products.length);
console.log('  Designer             :', byCat('Designer'));
console.log('  Niche                :', byCat('Niche'));
console.log('  Arabic               :', byCat('Arabic'));
console.log('DISTINCT BRANDS        :', new Set(products.map(p=>p.brand)).size);
console.log('FLAGGED (not imported) :', flagged.length);
console.log('EXACT DUPLICATES       :', dupes.length);
console.log('NEAR-DUP GROUPS        :', near.length);
console.log('missing concentration  :', notes.noConc.length);
console.log('missing size           :', notes.noSize.length);
console.log('missing gender         :', notes.noGender.length);
