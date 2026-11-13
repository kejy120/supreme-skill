#!/usr/bin/env node
// verify.mjs - verificador general: detecta el tipo de proyecto y corre SUS puertas reales.
// El equivalente de scroll-qa.mjs para lo que no es una pagina web.
//
//   node verify.mjs --dir ./proyecto            detecta y corre todo lo que exista
//   node verify.mjs --dir . --only test,build   solo esas
//   node verify.mjs --dir . --dry               dice que correria, sin correrlo
//   node verify.mjs --dir . --json
//
// Principio: NO inventa comandos. Solo corre lo que el manifiesto del proyecto declara.
// Lo que no existe se reporta como OMITIDA, nunca como aprobada. Un verificador que
// aprueba por ausencia de pruebas es peor que no tener verificador.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, relative } from 'node:path';

const argv = process.argv.slice(2);
const opt = (f, d) => { const i = argv.indexOf(f); return i === -1 ? d : argv[i + 1]; };
const has = f => argv.includes(f);
const dir = resolve(opt('--dir', '.'));
const only = (opt('--only', '') || '').split(',').filter(Boolean);
const jsonOut = has('--json');
const dry = has('--dry');

if (!existsSync(dir)) { console.error(`  ERROR: no existe ${dir}`); process.exit(2); }

const read = f => { try { return readFileSync(join(dir, f), 'utf8'); } catch { return null; } };
const hasF = f => existsSync(join(dir, f));

// ---------- deteccion ----------
const stack = [];
const gates = [];   // { fase, cmd, args, por que }
const add = (fase, cmd, args, why) => gates.push({ fase, cmd, args, why });

const pkgRaw = read('package.json');
if (pkgRaw) {
  let pkg = {}; try { pkg = JSON.parse(pkgRaw); } catch {}
  const sc = pkg.scripts || {};
  const pm = hasF('pnpm-lock.yaml') ? 'pnpm' : hasF('yarn.lock') ? 'yarn' : hasF('bun.lockb') ? 'bun' : 'npm';
  stack.push(`node (${pm})`);
  const run = n => pm === 'npm' ? ['run', n] : [n];
  for (const [fase, names] of [
    ['lint',      ['lint', 'eslint']],
    ['typecheck', ['typecheck', 'type-check', 'tsc', 'types']],
    ['test',      ['test', 'tests', 'test:unit']],
    ['build',     ['build', 'compile']],
  ]) {
    const hit = names.find(n => sc[n]);
    if (hit) add(fase, pm, run(hit), `package.json scripts.${hit}`);
  }
  if (!sc.typecheck && !sc['type-check'] && hasF('tsconfig.json'))
    add('typecheck', 'npx', ['--no-install', 'tsc', '--noEmit'], 'hay tsconfig.json pero ningun script');
}

if (hasF('pyproject.toml') || hasF('setup.py') || hasF('requirements.txt')) {
  stack.push('python');
  const py = read('pyproject.toml') || '';
  if (/\[tool\.ruff/.test(py) || hasF('ruff.toml')) add('lint', 'ruff', ['check', '.'], 'config de ruff');
  else if (/flake8/.test(py)) add('lint', 'flake8', ['.'], 'flake8 en pyproject');
  if (/\[tool\.mypy/.test(py) || hasF('mypy.ini')) add('typecheck', 'mypy', ['.'], 'config de mypy');
  if (/\[tool\.pytest/.test(py) || hasF('pytest.ini') || hasF('tests') || hasF('test'))
    add('test', 'pytest', ['-q'], 'hay tests o config de pytest');
}

if (hasF('go.mod')) {
  stack.push('go');
  add('lint', 'go', ['vet', './...'], 'go.mod');
  add('test', 'go', ['test', './...'], 'go.mod');
  add('build', 'go', ['build', './...'], 'go.mod');
}

if (hasF('Cargo.toml')) {
  stack.push('rust');
  add('lint', 'cargo', ['clippy', '--', '-D', 'warnings'], 'Cargo.toml');
  add('test', 'cargo', ['test'], 'Cargo.toml');
  add('build', 'cargo', ['build'], 'Cargo.toml');
}

if (hasF('Makefile') && !gates.length) {
  const mk = read('Makefile') || '';
  stack.push('make');
  for (const t of ['lint', 'test', 'build', 'check'])
    if (new RegExp(`^${t}:`, 'm').test(mk)) add(t === 'check' ? 'test' : t, 'make', [t], `target ${t} en Makefile`);
}

const plan = only.length ? gates.filter(g => only.includes(g.fase)) : gates;

const EXIT = { PASA: 0, 'PASA-CRITERIOS': 0, PLAN: 0, FALLA: 1, 'SIN-EVIDENCIA': 2, 'NO-RECONOCIDO': 2, 'NO-INSTALADO': 2 };
const finish = (estado, obj = {}) => {
  if (jsonOut) console.log(JSON.stringify({ dir, stack, ...obj, estado }, null, 2));
  process.exit(EXIT[estado]);
};

// ---------- dominio proceso (solo si no se reconoce otro stack) ----------
function proceso() {
  const docs = [];
  const walk = d => {
    for (const n of readdirSync(d)) {
      if (n === '.supreme' || n === '.git' || n === 'node_modules') continue;
      const f = join(d, n), st = statSync(f);
      if (st.isDirectory()) walk(f);
      else if (/\.(md|txt)$/i.test(n)) docs.push(f);
    }
  };
  walk(dir);
  const rel = f => relative(dir, f);
  const fallos = [];
  const texto = new Map(docs.map(f => [f, readFileSync(f, 'utf8')]));
  for (const [f, t] of texto) {
    if (!t.trim()) { fallos.push(`${rel(f)}: archivo vacio`); continue; }
    const m = t.match(/\b(?:TODO|TBD|XXX)\b|\b[Ll]orem\b|\[nombre\]|\{\{/);
    if (m) fallos.push(`${rel(f)}: marcador pendiente "${m[0]}"`);
    for (const l of t.matchAll(/\[[^\]]*\]\(([^)\s]+)/g)) {
      const u = l[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(u)) continue;
      let ruta = u.split('#')[0].split('?')[0];
      try { ruta = decodeURI(ruta); } catch {}
      if (ruta && !existsSync(join(dirname(f), ruta))) fallos.push(`${rel(f)}: enlace roto ${u}`);
    }
  }
  let crit = null, critErr = null;
  const raw = read('.supreme/criterios.json');
  if (raw !== null) { try { crit = JSON.parse(raw); } catch (e) { critErr = e.message; } }
  const util = crit && typeof crit === 'object' && ['archivos', 'secciones', 'requiere', 'prohibe', 'palabras']
    .some(k => crit[k] && (!Array.isArray(crit[k]) || crit[k].length));
  if (util) {
    let corpus = [...texto.values()];
    if (crit.archivos?.length) {
      corpus = [];
      for (const a of crit.archivos) {
        if (texto.has(join(dir, a))) corpus.push(texto.get(join(dir, a)));
        else if (hasF(a)) corpus.push(read(a));
        else fallos.push(`falta archivo exigido: ${a}`);
      }
    }
    const all = corpus.join('\n');
    const lineas = new Set(all.split('\n').map(l => l.trim()));
    for (const h of crit.secciones || []) if (!lineas.has(h.trim())) fallos.push(`falta seccion: ${h}`);
    const pat = x => { const m = /^\/(.*)\/([a-z]*)$/s.exec(x); return m ? new RegExp(m[1], m[2]) : null; };
    const hit = x => { const r = pat(x); return r ? r.test(all) : all.includes(x); };
    for (const x of crit.requiere || []) if (!hit(x)) fallos.push(`falta texto exigido: ${x}`);
    for (const x of crit.prohibe || []) if (hit(x)) fallos.push(`texto prohibido presente: ${x}`);
    if (crit.palabras) {
      const n = all.split(/\s+/).filter(Boolean).length;
      if (crit.palabras.min != null && n < crit.palabras.min) fallos.push(`palabras ${n} < min ${crit.palabras.min}`);
      if (crit.palabras.max != null && n > crit.palabras.max) fallos.push(`palabras ${n} > max ${crit.palabras.max}`);
    }
  }
  return { fallos, util, critErr, ndocs: docs.length };
}

if (!stack.length) {
  const p = proceso();
  const dom = { dominio: 'proceso', fallos: p.fallos };
  let estado = p.fallos.length ? 'FALLA' : p.util ? 'PASA-CRITERIOS' : 'NO-RECONOCIDO';
  if (jsonOut) {
    if (estado === 'NO-RECONOCIDO' && !p.critErr) { console.log(JSON.stringify({ stack: [], estado })); process.exit(2); }
    console.log(JSON.stringify({ dir, stack: [], ...dom, ...(p.critErr ? { error: `criterios.json invalido: ${p.critErr}` } : {}), estado }, null, 2));
    process.exit(EXIT[estado]);
  }
  console.log(`\n  verify  ${dir}\n`);
  if (estado === 'NO-RECONOCIDO' || p.critErr) {
    console.log('  NO SE RECONOCE EL PROYECTO — no hay package.json, pyproject.toml, go.mod,');
    console.log('  Cargo.toml ni Makefile con targets estandar, y no hay .supreme/criterios.json util.');
    if (p.critErr) console.log(`  criterios.json invalido: ${p.critErr}`);
    console.log('  No apruebo por ausencia de pruebas. Dime como se verifica y lo añado.\n');
    if (p.fallos.length) { console.log('  Higiene:'); for (const f of p.fallos) console.log(`   - ${f}`); console.log(''); estado = 'FALLA'; }
    process.exit(p.fallos.length ? 1 : 2);
  }
  console.log(`  dominio: proceso (${p.ndocs} documento(s), criterios.json)\n`);
  for (const f of p.fallos) console.log(`   - ${f}`);
  console.log(p.fallos.length ? `\n  BLOQUEADO: ${p.fallos.length} fallo(s)\n` : '  PASA-CRITERIOS: criterios cumplidos e higiene limpia (no hubo tests ejecutados).\n');
  process.exit(EXIT[estado]);
}

if (dry || !plan.length) {
  if (jsonOut) finish(plan.length ? 'PLAN' : 'SIN-EVIDENCIA', { plan: plan.map(g => ({ fase: g.fase, cmd: `${g.cmd} ${g.args.join(' ')}`, why: g.why })), dry });
  console.log(`\n  verify  ${dir}\n  stack: ${stack.join(', ')}\n`);
  if (!plan.length) console.log('  NINGUNA PUERTA DETECTADA. El proyecto no declara lint/test/build.\n  Eso no es un aprobado: es que no hay nada que comprobar.\n');
  else { console.log('  PLAN (plan, NO verifica: no se ejecuto nada)\n'); for (const g of plan) console.log(`  ${g.fase.padEnd(10)} ${g.cmd} ${g.args.join(' ')}   (${g.why})`); console.log(''); }
  process.exit(plan.length ? 0 : 2);
}

// ---------- evidencia de pruebas ----------
const FORMATOS = 'node --test (# pass N), jest/vitest (Tests: N passed), mocha (N passing), pytest (N passed), cargo (test result: ok. N passed), go (lineas ok), TAP (ok N)';
function contarTests(out) {
  const num = (re, flags = 'm') => { const m = out.match(new RegExp(re, flags)); return m ? Number(m[1]) : 0; };
  const sum = re => [...out.matchAll(new RegExp(re, 'gm'))].reduce((a, m) => a + Number(m[1]), 0);
  const goOk = out.split('\n').filter(l => /^ok\s/.test(l) && !/\[no tests to run\]|\[no test files\]/.test(l)).length;
  return num('^# pass (\\d+)') || num('Tests:?\\s+.*?(\\d+) passed') || num('(\\d+) passing')
    || num('(\\d+) passed') || sum('test result: ok\\. (\\d+) passed') || goOk
    || (out.match(/^ok \d+/gm) || []).length;
}

// ---------- ejecutar ----------
const results = [];
for (const g of plan) {
  const t0 = Date.now();
  const r = spawnSync(g.cmd, g.args, { cwd: dir, encoding: 'utf8', timeout: 15 * 60 * 1000 });
  const ms = Date.now() - t0;
  const missing = r.error && r.error.code === 'ENOENT';
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  const noInst = missing || (g.args[0] === '--no-install' && r.status !== 0 && /could not determine executable|not found|npx canceled/i.test(out));
  let estado = noInst ? 'NO-INSTALADO' : r.status === 0 ? 'PASA' : 'FALLA';
  let tests;
  if (g.fase === 'test') {
    // El runner falla por no encontrar tests: no es un fallo de las pruebas, es ausencia de ellas.
    const sinTests = (g.cmd === 'pytest' && r.status === 5) || /no tests? (files )?found|no test files|0 tests? (ran|run)|no tests to run/i.test(out);
    if (estado === 'FALLA' && sinTests) estado = 'SIN-EVIDENCIA';
    else if (estado === 'PASA') { tests = contarTests(out); if (!tests) estado = 'SIN-EVIDENCIA'; }
  }
  results.push({
    fase: g.fase, cmd: `${g.cmd} ${g.args.join(' ')}`, why: g.why, ms,
    estado, ...(tests !== undefined ? { tests } : {}),
    code: r.status, cola: out.split('\n').slice(-12).join('\n'),
  });
}

const fallan = results.filter(r => r.estado === 'FALLA');
const faltan = results.filter(r => r.estado === 'NO-INSTALADO');
const sinEv = results.filter(r => r.estado === 'SIN-EVIDENCIA');
const hayEvidencia = results.some(r => r.fase === 'test' && r.estado === 'PASA');
const estado = fallan.length ? 'FALLA' : faltan.length ? 'NO-INSTALADO' : (sinEv.length || !hayEvidencia) ? 'SIN-EVIDENCIA' : 'PASA';

if (jsonOut) {
  console.log(JSON.stringify({ dir, stack, results, fallan: fallan.length, faltan: faltan.length, estado }, null, 2));
} else {
  console.log(`\n  verify  ${dir}\n  stack: ${stack.join(', ')}\n`);
  for (const r of results)
    console.log(`  ${r.estado.padEnd(13)} ${r.fase.padEnd(10)} ${r.cmd.padEnd(34)} ${(r.ms / 1000).toFixed(1)}s${r.tests ? `  (${r.tests} tests)` : ''}`);
  for (const r of fallan) {
    console.log(`\n  --- ${r.fase} (${r.cmd}) exit ${r.code} ---`);
    console.log(r.cola.split('\n').map(l => '  ' + l).join('\n'));
  }
  if (faltan.length)
    console.log(`\n  AVISO: ${faltan.map(r => r.cmd.split(' ')[0]).join(', ')} no esta instalado. Esa puerta NO se comprobo.`);
  console.log(`\n  ${results.filter(r => r.estado === 'PASA').length}/${results.length} puertas superadas`);
  console.log(fallan.length ? `  BLOQUEADO: ${fallan.map(r => r.fase).join(', ')}\n`
            : faltan.length ? `  Lo que corrio pasa, pero ${faltan.length} puerta(s) quedaron sin comprobar.\n`
            : estado === 'SIN-EVIDENCIA' ? `  NO VERIFICADO: no hay evidencia de pruebas ejecutadas (0 tests, sin fase test, o salida no reconocida).\n  Formatos reconocidos: ${FORMATOS}.\n`
            : `  Todas las puertas del proyecto pasan.\n`);
}
process.exit(EXIT[estado]);
