#!/usr/bin/env node
// rubric.mjs - puntua 0/1/2 lo que SE PUEDE MEDIR de un diseno renderizado.
// No sustituye el juicio: lo acota. Un sistema de diseno con 23 tamanos de fuente
// distintos no es discutible, es que no hay sistema.
//
//   node rubric.mjs <url|archivo.html> [--viewport WxH] [--min 14] [--json]

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('falta playwright: cd bin && npm ci'); process.exit(2); }

const argv = process.argv.slice(2);
if (!argv[0] || argv.includes('--help')) {
  console.log(`rubric.mjs <url|archivo.html> [--viewport WxH] [--min N] [--json]
Puntua 8 criterios medibles 0/1/2 (max 16). Umbral por defecto: 12.`);
  process.exit(argv[0] ? 0 : 2);
}
const opt = (f, d) => { const i = argv.indexOf(f); return i === -1 ? d : argv[i + 1]; };
const target = argv[0];
const url = /^https?:\/\//.test(target) ? target : pathToFileURL(resolve(target)).href;
const [vw, vh] = opt('--viewport', '1440x900').split('x').map(Number);
const MIN = +opt('--min', '12');

const browser = await chromium.launch({ args: ['--no-sandbox'] });
let m;
try {
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
await page.goto(url, { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(700);

m = await page.evaluate(() => {
  const px = v => parseFloat(v) || 0;
  const sizes = new Map(), weights = new Map(), families = new Map();
  const spaces = new Map(), radii = new Map(), colors = new Map(), bgs = new Map();
  const bodyLines = [];
  const textNodes = [];

  const srgb = c => { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };
  const lum = rgb => { const [r, g, b] = rgb; return .2126 * srgb(r) + .7152 * srgb(g) + .0722 * srgb(b); };
  const parse = s => { const m = s.match(/\d+(\.\d+)?/g); return m ? m.slice(0, 3).map(Number) : null; };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + .05) / (lo + .05); };

  // fondo efectivo subiendo por ancestros hasta encontrar uno opaco
  const effBg = el => {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return parse(bg);
      n = n.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255];
  };

  const SKIP = new Set(['HTML','HEAD','SCRIPT','STYLE','META','LINK','TITLE','NOSCRIPT','BR']);
  for (const el of document.querySelectorAll('*')) {
    if (SKIP.has(el.tagName)) continue;
    const g = getComputedStyle(el);
    if (g.display === 'none' || g.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;

    const fs = Math.round(px(g.fontSize));
    if (fs) sizes.set(fs, (sizes.get(fs) || 0) + 1);
    weights.set(g.fontWeight, (weights.get(g.fontWeight) || 0) + 1);
    families.set(g.fontFamily.split(',')[0].replace(/["']/g, '').trim(), 1);

    for (const p of ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'gap', 'rowGap']) {
      const v = Math.round(px(g[p]));
      if (v > 0) spaces.set(v, (spaces.get(v) || 0) + 1);
    }
    const rad = Math.round(px(g.borderTopLeftRadius));
    if (rad > 0) radii.set(rad, (radii.get(rad) || 0) + 1);

    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 8);
    if (own) {
      const fg = parse(g.color), bg = effBg(el);
      if (fg && bg) {
        const cr = ratio(fg, bg);
        const big = fs >= 24 || (fs >= 18.66 && +g.fontWeight >= 700);
        textNodes.push({ cr: +cr.toFixed(2), need: big ? 3 : 4.5, fs, text: el.textContent.trim().slice(0, 40) });
      }
      colors.set(g.color, (colors.get(g.color) || 0) + 1);
      if (fs >= 14 && fs <= 22) {
        // medida de longitud de linea en caracteres, aproximada por ancho/ancho-de-caracter
        const ch = r.width / (fs * 0.5);
        if (ch > 8) bodyLines.push(Math.round(ch));
      }
    }
    const bg = g.backgroundColor;
    if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) bgs.set(bg, (bgs.get(bg) || 0) + 1);
  }

  const med = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0;
  return {
    sizes: [...sizes.entries()].sort((a, b) => b[1] - a[1]),
    weights: [...weights.keys()],
    families: [...families.keys()],
    spaces: [...spaces.entries()].sort((a, b) => b[1] - a[1]),
    radii: [...radii.keys()],
    colors: [...colors.keys()],
    bgs: [...bgs.keys()],
    failContrast: textNodes.filter(t => t.cr < t.need).slice(0, 8),
    contrastChecked: textNodes.length,
    medianLine: med(bodyLines),
    focusVisible: [...document.querySelectorAll('a,button,input,select,textarea,[tabindex]')].length,
    textBlocks: textNodes.length,
    elements: document.querySelectorAll('body *').length,
    words: (document.body.innerText || '').trim().split(/\s+/).length,
  };
});
} finally { await browser.close().catch(() => {}); }

// ---- guarda de densidad ----
// Una pagina casi vacia saca sobresaliente en "pocos tamanos, pocos colores" sin merecerlo.
// Medido: una demo rota con 1 bloque de texto puntuaba 14/16, mas que una landing real.
const SPARSE = m.textBlocks < 6 || m.words < 60;
if (SPARSE) {
  const msg = `contenido insuficiente para puntuar: ${m.textBlocks} bloques de texto, ${m.words} palabras, ${m.elements} elementos`;
  if (argv.includes('--json')) console.log(JSON.stringify({ url, scorable: false, reason: msg, raw: m }, null, 2));
  else console.log(`\n  rubric  ${url}\n\n  NO PUNTUABLE — ${msg}\n  Los criterios de sistema (pocos tamanos, pocos colores) premian el vacio.\n  Hacen falta al menos 6 bloques de texto y 60 palabras.\n`);
  process.exit(2);
}

// ---- puntuacion ----
const crit = [];
const add = (n, score, detail) => crit.push({ n, score, detail });

// 1. escala tipografica: pocos tamanos = hay sistema
const nSizes = m.sizes.length;
add('escala tipográfica', nSizes <= 7 ? 2 : nSizes <= 11 ? 1 : 0,
  `${nSizes} tamaños distintos [${m.sizes.slice(0, 8).map(s => s[0]).join(', ')}] — 7 o menos es un sistema, 12+ es improvisación`);

// 2. pesos
add('pesos tipográficos', m.weights.length <= 4 ? 2 : m.weights.length <= 6 ? 1 : 0,
  `${m.weights.length} pesos [${m.weights.join(', ')}]`);

// 3. familias
add('familias', m.families.length <= 2 ? 2 : m.families.length === 3 ? 1 : 0,
  `${m.families.length}: ${m.families.slice(0, 4).join(', ')}`);

// 4. escala de espaciado
const nSp = m.spaces.length;
add('escala de espaciado', nSp <= 10 ? 2 : nSp <= 18 ? 1 : 0,
  `${nSp} valores distintos [${m.spaces.slice(0, 10).map(s => s[0]).join(', ')}]`);

// 5. paleta
const nCol = new Set([...m.colors, ...m.bgs]).size;
add('paleta', nCol <= 10 ? 2 : nCol <= 18 ? 1 : 0, `${nCol} colores distintos (texto + fondos)`);

// 6. radios
add('radios', m.radii.length <= 3 ? 2 : m.radii.length <= 5 ? 1 : 0,
  `${m.radii.length} radios [${m.radii.slice(0, 6).join(', ')}]`);

// 7. contraste AA — este no se negocia
add('contraste AA', m.failContrast.length === 0 ? 2 : m.failContrast.length <= 2 ? 1 : 0,
  m.failContrast.length
    ? `${m.failContrast.length}/${m.contrastChecked} fallan: ` +
      m.failContrast.slice(0, 3).map(f => `"${f.text}" ${f.cr}:1 (necesita ${f.need})`).join(' · ')
    : `${m.contrastChecked} bloques de texto, todos cumplen`);

// 8. longitud de linea
const ml = m.medianLine;
add('longitud de línea', ml >= 45 && ml <= 80 ? 2 : ml >= 35 && ml <= 95 ? 1 : 0,
  `mediana ${ml} caracteres — la banda legible es 45-80`);

const total = crit.reduce((s, c) => s + c.score, 0);
const max = crit.length * 2;

if (argv.includes('--json')) {
  console.log(JSON.stringify({ url, total, max, min: MIN, crit, raw: m }, null, 2));
} else {
  console.log(`\n  rubric  ${url}\n`);
  for (const c of crit) console.log(`  ${c.score}/2  ${c.n.padEnd(22)} ${c.detail}`);
  console.log(`\n  ${total}/${max}  umbral ${MIN}`);
  console.log(total >= MIN
    ? '  Pasa lo medible. El juicio sobre jerarquía, ritmo y tono sigue siendo tuyo.\n'
    : `  BLOQUEADO: por debajo de ${MIN}. Arregla los criterios en 0 antes de tocar nada más.\n`);
}
process.exit(total >= MIN ? 0 : 1);
