#!/usr/bin/env node
// loop.mjs - bucle de iteracion sobre run.mjs. Mide, espera a que cambies algo, vuelve a medir.
// Lo que aporta sobre correr run.mjs a mano: el DELTA entre intentos. Saber que arreglaste
// cls pero rompiste compositor vale mas que saber que sigues bloqueado.
//
//   node loop.mjs --dir ./sitio                  hasta pasar, max 5 intentos
//   node loop.mjs --dir ./sitio --max 3
//   node loop.mjs --dir ./sitio --watch          sin limite, para con Ctrl-C
//   node loop.mjs --dir ./sitio -- --shots 3 --preflight    resto va a run.mjs
//
// Entre intentos espera a que cambie un archivo del proyecto: sondea el arbol cada 1 s;
// si no tocas nada, no vuelve a medir.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, renameSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const mine = sep === -1 ? argv : argv.slice(0, sep);
const passthru = sep === -1 ? [] : argv.slice(sep + 1);
const opt = (f, d) => { const i = mine.indexOf(f); return i === -1 ? d : mine[i + 1]; };
const has = f => mine.includes(f);

if (has('--help') || !opt('--dir', null)) {
  console.log(`loop.mjs --dir DIR [--max N] [--watch] [--timeout SEG] [--budget-ms MS] [-- <args de run.mjs>]

  --max N        intentos maximos, entero >=1 (def: 5). Ignorado con --watch
  --watch        sin limite; para con Ctrl-C
  --timeout S    segundos esperando un cambio antes de rendirse, entero >=1 (def: 900)
  --budget-ms M  tope total de tiempo del bucle, entero >=1 (def: sin tope)

Salida: una linea por intento; el detalle va a DIR/.supreme/intento-N.log
Salidas:
  0  paso
  1  fallo: intentos agotados (siempre 1), presupuesto agotado o ESTANCADO (3 intentos con el mismo fallo)
  2  no verificado (proyecto no reconocido / sin evidencia), argumento invalido,
     o nadie toco nada dentro del timeout`);
  process.exit(opt('--dir', null) ? 0 : 2);
}

// entero >=1 o salir con 2 nombrando el flag
function entero(flag, def) {
  if (!mine.includes(flag)) return def;
  const v = opt(flag, undefined);
  if (v === undefined || !/^[0-9]+$/.test(v) || +v < 1) {
    console.error(`  ERROR: ${flag} necesita un entero >= 1 (recibido: ${v === undefined ? '(nada)' : JSON.stringify(v)})`);
    process.exit(2);
  }
  return +v;
}

const dir = resolve(opt('--dir'));
const watch = has('--watch');
const maxN = entero('--max', 5);
const max = watch ? Infinity : maxN;
const waitSec = entero('--timeout', 900);
const budgetMs = entero('--budget-ms', Infinity);
const node = process.execPath;
const T_INI = Date.now();

if (!existsSync(dir)) { console.error(`  ERROR: no existe ${dir}`); process.exit(2); }
if (passthru.length && !existsSync(join(dir, 'index.html')))
  console.error(`  AVISO: el proyecto no es web (sin index.html); se ignoran los flags tras --: ${passthru.join(' ')}`);

const IGNORAR = /(^|\/)(qa-out|\.supreme|node_modules|\.git|__pycache__|dist|build|\.next|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.nyc_output|coverage|target|\.turbo|\.cache)(\/|$)|\.tsbuildinfo$/;

// huella del arbol: ruta+mtime+tamaño de todo lo que no esta ignorado
function huella(d, depth = 0) {
  if (depth > 6) return '';
  let s = '';
  let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return ''; }
  for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(d, e.name);
    if (IGNORAR.test(p.slice(dir.length))) continue;
    if (e.isDirectory()) s += huella(p, depth + 1);
    else { try { const st = statSync(p); s += `${p}:${st.mtimeMs}:${st.size};`; } catch {} }
  }
  return s;
}

const esWeb = existsSync(join(dir, 'index.html'));
const criteriosPath = join(dir, '.supreme', 'criterios.json');

// UNA medicion por intento. Devuelve { code, tipo, m, estado, cola, salida, bytes }
function medir() {
  const t0 = Date.now();
  const mx = { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 };
  if (esWeb) {
    const r = spawnSync(node, [join(HERE, 'run.mjs'), '--dir', dir, ...passthru], mx);
    const salida = (r.stdout || '') + (r.stderr || '');
    const m = {};
    const rep = join(dir, 'qa-out', 'report.json');
    try {
      if (existsSync(rep) && statSync(rep).mtimeMs >= t0) {
        for (const g of JSON.parse(readFileSync(rep, 'utf8')).gates) m[g.name] = g.pass;
      }
    } catch {}
    return { code: r.status ?? 2, tipo: 'web', m, estado: undefined, cola: salida.split('\n').slice(-20).join('\n'), salida };
  }
  const r = spawnSync(node, [join(HERE, 'verify.mjs'), '--dir', dir, '--json'], mx);
  const salida = (r.stdout || '') + (r.stderr || '');
  const m = {}; let estado, cola = '';
  try {
    const j = JSON.parse(r.stdout);
    estado = j.estado;
    for (const x of j.results || []) m[x.fase] = x.estado === 'PASA';
    cola = (j.results || []).filter(x => x.estado !== 'PASA').map(x => x.cola || '').join('\n');
  } catch { cola = salida.split('\n').slice(-20).join('\n'); }
  return { code: r.status ?? 2, tipo: 'codigo', m, estado, cola, salida };
}

// firma de fallo: puertas que fallan + cola sin digitos ni rutas
function firma(fallan, cola) {
  const norm = cola.replace(/\S*\/\S*/g, '').replace(/[0-9]+/g, '').replace(/\s+/g, ' ').trim();
  return createHash('sha1').update([...fallan].sort().join(',') + '|' + norm).digest('hex');
}

function delta(antes, ahora) {
  if (!antes) return null;
  const arreglado = [], roto = [], siguen = [];
  for (const k of new Set([...Object.keys(antes), ...Object.keys(ahora)])) {
    const a = antes[k], b = ahora[k];
    if (a === false && b === true) arreglado.push(k);
    else if (a === true && b === false) roto.push(k);
    else if (b === false) siguen.push(k);
  }
  return { arreglado, roto, siguen };
}
const deltaTxt = d => !d ? '-' : [
  ...d.arreglado.map(k => `+${k}`), ...d.roto.map(k => `-${k}`), ...d.siguen.map(k => `=${k}`)].join(',') || '0';

const histPath = join(dir, '.supreme', 'loop-history.json');
let hist = [];
if (existsSync(histPath)) {
  try { hist = JSON.parse(readFileSync(histPath, 'utf8')); if (!Array.isArray(hist)) throw 0; }
  catch {
    const bak = `${histPath}.corrupt-${Date.now()}`;
    try { renameSync(histPath, bak); console.error(`  AVISO: historial ilegible, movido a ${bak}`); } catch {}
    hist = [];
  }
}

let previo = null, intento = 0, code = 1, fin = '';
let parar = false;
const firmas = [];
process.on('SIGINT', () => { parar = true; console.log('\n  Ctrl-C — cerrando el bucle.'); });

while (intento < max && !parar) {
  if (Date.now() - T_INI >= budgetMs) { fin = `PRESUPUESTO agotado (${budgetMs} ms)`; code = 1; break; }
  intento++;
  const base0 = huella(dir);            // huella ANTES de medir
  const t0 = Date.now();
  const med = medir();
  const ms = Date.now() - t0;
  const m = med.m;
  code = med.code;

  // sin evidencia: no se crea nada ni se espera
  const sinEvidencia = !esWeb && !existsSync(criteriosPath) &&
    (med.estado === 'NO-RECONOCIDO' || med.estado === 'SIN-EVIDENCIA' || (med.estado === undefined && code === 2 && !Object.keys(m).length));
  if (sinEvidencia) {
    console.error(`  NO VERIFICADO (${med.estado || 'proyecto no reconocido'}): no hay evidencia medible en ${dir}. Salgo sin esperar.`);
    process.exit(2);
  }

  const d = delta(previo, m);
  const fallan = Object.entries(m).filter(([, v]) => !v).map(([k]) => k);
  const fallanTxt = fallan.length ? fallan.join(',') : (code === 0 ? '-' : '(ver log)');
  const logPath = join(dir, '.supreme', `intento-${intento}.log`);
  mkdirSync(join(dir, '.supreme'), { recursive: true });
  writeFileSync(logPath, `# intento ${intento} exit=${code} estado=${med.estado ?? '?'} ${ms}ms\n# delta: ${deltaTxt(d)}\n\n${med.salida}`);
  console.log(`#${intento} exit=${code} fallan=${fallanTxt} delta=${deltaTxt(d)} log=${logPath}`);

  hist.push({ intento, at: new Date().toISOString(), tipo: med.tipo, exit: code, estado: med.estado, fallan, delta: d, ms, bytes: Buffer.byteLength(med.salida) });
  writeFileSync(histPath, JSON.stringify(hist, null, 2));
  previo = m;

  if (med.estado === 'PASA-CRITERIOS') code = 0;
  if (code === 0) { fin = `PASO en el intento ${intento}`; break; }

  firmas.push(firma(fallan, med.cola));
  if (firmas.length >= 3 && firmas.slice(-3).every(f => f === firmas[firmas.length - 1])) {
    fin = `ESTANCADO: mismo fallo en 3 intentos seguidos (${fallanTxt})`; code = 1; break;
  }
  if (intento >= max && !watch) { fin = `AGOTADOS los ${max} intentos. Siguen fallando: ${fallanTxt}`; code = 1; break; }

  // cambio durante la medicion: repetir sin esperar
  if (huella(dir) !== base0) continue;

  // esperar a que alguien toque el proyecto
  const base = huella(dir);
  const tw = Date.now();
  let cambio = false, presup = false;
  while (Date.now() - tw < waitSec * 1000 && !parar) {
    if (Date.now() - T_INI >= budgetMs) { presup = true; break; }
    spawnSync('sleep', ['1']);
    if (huella(dir) !== base) { cambio = true; break; }
  }
  if (parar) break;
  if (presup) { fin = `PRESUPUESTO agotado (${budgetMs} ms)`; code = 1; break; }
  if (!cambio) { fin = `Nadie toco nada en ${waitSec}s`; code = 2; break; }
}

console.log(`${fin || 'fin'} | ${hist.length} intento(s) en ${histPath}`);
process.exit(code);
