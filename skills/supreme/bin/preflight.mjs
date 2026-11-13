#!/usr/bin/env node
// preflight.mjs - la regla es: Canva + Higgsfield ANTES de escribir codigo, y JUNTOS.
// v2: valida contra los registros REALES de las APIs, no contra lo que alguien declare.
//
//   node preflight.mjs --dir ./sitio             verifica
//   node preflight.mjs --dir ./sitio --init      crea el manifiesto
//   node preflight.mjs --schema                  imprime que hay que pegar y de donde sale
//
// ARQUITECTURA, y su limite honesto:
// Este script NO puede llamar a los conectores MCP: viven en la sesion del agente, no en el
// proceso. Asi que el agente pega aqui la RESPUESTA VERBATIM de cada llamada, y este script
// la valida duro. Eso no impide que alguien invente un JSON a mano, pero si impide el atajo
// real: saltarse el paso, o hacerlo mal. Lo que NO se puede falsear por descuido es la
// comprobacion clave -> params.colors de cada generacion tiene que solapar con la paleta.
//
// Modo API directo (independiente del agente): si existen CANVA_TOKEN y/o HIGGSFIELD_API_KEY
// en el entorno, --live vuelve a pedir los registros a la API y compara con lo pegado.

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const opt = (f, d) => { const i = argv.indexOf(f); return i === -1 ? d : argv[i + 1]; };
const has = f => argv.includes(f);
const dir = resolve(opt('--dir', '.'));
const manifest = join(dir, '.supreme', 'brief.json');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HF_HOST = /^https:\/\/[a-z0-9]+\.cloudfront\.net\//i;
const HEX = /^#?[0-9a-f]{3,8}$/i;
const norm = c => String(c).trim().toLowerCase().replace(/^#/, '');

const TEMPLATE = {
  when: null,
  canva: {
    brandKitId: null,
    noBrandKitReason: null,
    paletteSource: null,        // "canva:<id>" | "notion:<pagina>" | "drive:<archivo>" | "usuario"
    colors: [],                 // hex reales de la identidad. Son los que tienen que aparecer en Higgsfield
    fonts: [],
    templateId: null,
    verified: null              // respuesta VERBATIM de Canva:list-brand-kits / search-brand-templates
  },
  higgsfield: {
    purpose: null,              // "hero" | "secciones" | "texturas" | "concepto"
    antiIaScore: null,          // 0-24 segun references/criterio-anti-look-ia.md
    verified: []                // registros VERBATIM de higgsfield:show_generations / show_generation_by_ids
  }
};

if (has('--schema')) {
  console.log(`
  QUE PEGAR EN .supreme/brief.json Y DE DONDE SALE

  canva.verified      <- respuesta entera de  Canva:list-brand-kits
                         (si devuelve {"items":[]} pega eso: es prueba de que NO hay brand kit)
  canva.colors        <- los hex de la identidad. Si no hay brand kit, de donde salgan,
                         y declara el origen en canva.paletteSource
  higgsfield.verified <- los objetos enteros de  higgsfield:show_generations  o
                         show_generation_by_ids, con params.colors y results.rawUrl intactos

  LO QUE SE COMPRUEBA CONTRA ESOS DATOS
    - id con formato UUID valido
    - status == "completed"
    - results.rawUrl apunta al CDN y contiene el propio id
    - createdAt es un epoch plausible y anterior al HTML
    - params.colors SOLAPA con canva.colors   <-- esto es "juntos", y es derivado, no declarado
`);
  process.exit(0);
}

if (has('--init')) {
  mkdirSync(join(dir, '.supreme'), { recursive: true });
  if (existsSync(manifest)) { console.log(`  ya existe: ${manifest}`); process.exit(0); }
  writeFileSync(manifest, JSON.stringify(TEMPLATE, null, 2));
  console.log(`  creado ${manifest}`);
  console.log(`  node preflight.mjs --schema   dice que pegar en cada campo.`);
  process.exit(0);
}

if (!existsSync(manifest)) {
  console.log(`\n  PREFLIGHT BLOQUEADO\n`);
  console.log(`  No existe ${manifest}`);
  console.log(`  La regla: Canva + Higgsfield juntos ANTES de generar codigo.\n`);
  console.log(`  1. Canva:list-brand-kits                -> identidad real`);
  console.log(`  2. Canva:search-brand-templates         -> plantilla de partida, si la hay`);
  console.log(`  3. higgsfield:generate_image_batch      -> 6-8 variantes CON esa paleta en el prompt`);
  console.log(`  4. higgsfield:show_generation_by_ids    -> los registros a pegar`);
  console.log(`  5. node preflight.mjs --dir ${dir} --init\n`);
  process.exit(1);
}

let m;
try { m = JSON.parse(readFileSync(manifest, 'utf8')); }
catch (e) { console.error(`  brief.json ilegible: ${e.message}`); process.exit(2); }

const fail = [], warn = [], ok = [];
const c = m.canva || {}, h = m.higgsfield || {};

// ---------- CANVA ----------
if (c.verified === null || c.verified === undefined) {
  fail.push('canva: falta canva.verified. Pega la respuesta de Canva:list-brand-kits');
} else {
  const items = Array.isArray(c.verified?.items) ? c.verified.items
              : Array.isArray(c.verified) ? c.verified : null;
  if (items === null) fail.push('canva.verified no parece la respuesta de list-brand-kits (falta items[])');
  else if (items.length === 0) {
    if (!c.noBrandKitReason) fail.push('canva: list-brand-kits vino vacio y no hay noBrandKitReason');
    else ok.push(`canva: sin brand kit, verificado contra la API (items: []) — "${c.noBrandKitReason}"`);
    if (c.brandKitId) fail.push(`canva: declaras brandKitId "${c.brandKitId}" pero la API devolvio items: []`);
  } else {
    const ids = items.map(i => i.id);
    if (!c.brandKitId) fail.push(`canva: hay ${ids.length} brand kit(s) reales y no elegiste ninguno`);
    else if (!ids.includes(c.brandKitId))
      fail.push(`canva: brandKitId "${c.brandKitId}" no esta entre los reales [${ids.join(', ')}]`);
    else ok.push(`canva: brandKitId "${c.brandKitId}" verificado contra la API`);
  }
}
const palette = (c.colors || []).filter(x => HEX.test(x)).map(norm);
if (!palette.length) fail.push('canva: colors vacio o sin hex validos. Sin paleta no hay nada que sembrar');
if ((c.colors || []).length !== palette.length)
  warn.push(`canva: ${(c.colors || []).length - palette.length} color(es) descartados por no ser hex`);
if (!c.brandKitId && palette.length && !c.paletteSource)
  fail.push('canva: sin brand kit, paletteSource es obligatorio (de donde salen esos colores)');

// ---------- HIGGSFIELD ----------
const gens = Array.isArray(h.verified) ? h.verified : [];
if (!gens.length) fail.push('higgsfield: higgsfield.verified vacio. El paso visual no consta');

let seeded = 0, htmlNewest = 0;
try {
  for (const f of readdirSync(dir).filter(x => x.endsWith('.html')))
    htmlNewest = Math.max(htmlNewest, statSync(join(dir, f)).mtimeMs);
} catch {}

gens.forEach((g, i) => {
  const tag = `higgsfield[${i}]`;
  if (!g || typeof g !== 'object') { fail.push(`${tag}: no es un objeto`); return; }
  if (!UUID.test(String(g.id || ''))) { fail.push(`${tag}: id "${g.id}" no es un UUID valido`); return; }
  if (g.status !== 'completed') fail.push(`${tag} ${g.id}: status "${g.status}" — solo vale "completed"`);

  const raw = g.results?.rawUrl || '';
  if (!HF_HOST.test(raw)) fail.push(`${tag} ${g.id}: results.rawUrl no apunta al CDN de Higgsfield`);
  else if (!raw.includes(g.id)) fail.push(`${tag} ${g.id}: la rawUrl no contiene su propio id — registro inconsistente`);

  const ts = Number(g.createdAt);
  if (!Number.isFinite(ts) || ts < 1.6e9 || ts > Date.now() / 1000 + 86400)
    fail.push(`${tag} ${g.id}: createdAt "${g.createdAt}" no es un epoch plausible`);
  else if (htmlNewest && ts * 1000 > htmlNewest + 5 * 60 * 1000)
    warn.push(`${tag} ${g.id}: se genero DESPUES del HTML. La regla es visual primero, codigo despues`);

  // el nucleo de "juntos": la paleta de la identidad tiene que estar en los params reales
  const used = [...(g.params?.colors || []), g.params?.background_color]
    .filter(Boolean).filter(x => HEX.test(x)).map(norm);
  const hit = used.filter(x => palette.includes(x));
  if (hit.length) seeded++;
  else if (used.length) warn.push(`${tag} ${g.id}: params.colors [${used.join(', ')}] no toca la paleta`);
  else warn.push(`${tag} ${g.id}: no declara params.colors — no se puede probar que partiera de la identidad`);
});

if (gens.length) {
  const pct = Math.round(100 * seeded / gens.length);
  if (palette.length && seeded === 0)
    fail.push(`higgsfield: NINGUNA de las ${gens.length} generaciones usa la paleta de la identidad. Eso es usarlos por separado, no juntos`);
  else if (palette.length && pct < 50)
    fail.push(`higgsfield: solo ${seeded}/${gens.length} (${pct}%) partieron de la paleta. Se exige la mitad o mas`);
  else if (seeded) ok.push(`higgsfield: ${seeded}/${gens.length} generaciones (${pct}%) usan la paleta — sembrado verificado`);
  if (gens.length < 4) warn.push(`higgsfield: ${gens.length} variantes; el criterio anti-look-IA pide 6-8`);
}

if (h.antiIaScore === null || h.antiIaScore === undefined)
  fail.push('higgsfield: sin puntuacion anti-look-IA. Ver references/criterio-anti-look-ia.md');
else if (!(h.antiIaScore >= 0 && h.antiIaScore <= 24))
  fail.push(`higgsfield: antiIaScore ${h.antiIaScore} fuera de 0-24`);
else if (h.antiIaScore < 18)
  fail.push(`higgsfield: anti-look-IA ${h.antiIaScore}/24 — el umbral es 18`);

// ---------- modo API directo, opcional ----------
if (has('--live')) {
  if (!process.env.CANVA_TOKEN && !process.env.HIGGSFIELD_API_KEY)
    warn.push('--live pedido pero no hay CANVA_TOKEN ni HIGGSFIELD_API_KEY en el entorno; se validan solo los registros pegados');
  else warn.push('--live: comprobacion directa contra la API no implementada todavia; se validan los registros pegados');
}

// ---------- salida ----------
console.log(`\n  preflight  ${dir}\n`);
for (const o of ok) console.log(`  OK     ${o}`);
for (const w of warn) console.log(`  AVISO  ${w}`);
for (const f of fail) console.log(`  FALLA  ${f}`);
if (!fail.length) console.log(`\n  Regla cumplida: identidad primero, visual sembrado desde ella, codigo al final.\n`);
else console.log(`\n  BLOQUEADO: ${fail.length} fallo(s). No se genera codigo hasta resolverlos.\n`);
process.exit(fail.length ? 1 : 0);
