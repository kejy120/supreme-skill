#!/usr/bin/env node
// run.mjs - punto de entrada unico. Hace el ciclo completo sin que nadie lo guie.
//
//   node run.mjs "landing con scroll para marca de relojes"     solo enruta (barato)
//   node run.mjs --dir ./sitio                                   sirve, mide y puntua
//   node run.mjs "brief..." --dir ./sitio                        ambas cosas
//   node run.mjs --dir ./sitio --page index.html --port 8731 --json
//
// Levanta el servidor, mide, puntua y lo para. Exit 0 solo si TODO pasa.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (f, d) => { const i = argv.indexOf(f); return i === -1 ? d : argv[i + 1]; };
const has = f => argv.includes(f);

if (has('--help') || has('-h') || (!argv.length)) {
  console.log(`run.mjs ["brief"] [--dir DIR] [--page ARCHIVO] [--port N] [--shots N] [--preflight] [--json]

Sin --dir: solo enruta el brief y sale (no cuesta nada, no abre navegador).
Con --dir: sirve el directorio, mide las puertas, puntua la rubrica y para el servidor.

--preflight     activa el modulo opcional Canva+Higgsfield (necesita esos conectores MCP)

Codigos de salida:
  0  todo pasa
  1  alguna puerta o la rubrica bloquea
  2  no verificado: error de invocacion, servidor sin respuesta, lsof ausente, skill-audit fallo,
     verify sin evidencia o pagina no puntuable (el veredicto dice la causa)`);
  process.exit(argv.length ? 0 : 2);
}

const VALUE_FLAGS = new Set(['--dir', '--page', '--port', '--shots']);
const brief = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(argv[i - 1])).join(' ').trim();
for (const f of VALUE_FLAGS) {
  const i = argv.indexOf(f);
  if (i !== -1 && (argv[i + 1] === undefined || argv[i + 1].startsWith('--'))) { console.error(`\n  ERROR: ${f} necesita un valor\n`); process.exit(2); }
}
const dir = opt('--dir', null);
const page = opt('--page', 'index.html');
const port = +opt('--port', '8731');
const shots = opt('--shots', '5');
const jsonOut = has('--json');

const node = process.execPath;
const sh = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...o });
const line = s => console.log(s);

let exitCode = 0;
let routeFail = false;
const out = { brief: brief || null, dir, steps: {} };

// ---------- 1. enrutar ----------
if (brief) {
  const r = sh(node, [join(HERE, 'skill-audit.mjs'), brief]);
  out.steps.route = { ok: r.status === 0 };
  if (r.status !== 0) { routeFail = true; console.error(`  ERROR: skill-audit fallo (exit ${r.status}) ${(r.stderr || '').trim().split('\n')[0]}`); }
  if (!jsonOut) { line('\n' + '='.repeat(62)); line('  PASO 1 — ENRUTADO'); line('='.repeat(62)); line(r.stdout.trim()); }
  else { const j = sh(node, [join(HERE, 'skill-audit.mjs'), brief, '--json']); try { out.steps.route = JSON.parse(j.stdout).routed; } catch {} }
}

if (!dir) {
  if (jsonOut) console.log(JSON.stringify(out, null, 2));
  else line('\n  Sin --dir no se mide nada. Cuando exista la pagina:\n    node run.mjs --dir <carpeta>\n');
  process.exit(routeFail ? 2 : 0);
}

// ---------- 1.4 el objetivo tiene que existir ANTES de hablar de reglas ----------
const root = resolve(dir);
if (!existsSync(root)) {
  console.error(`\n  ERROR: el directorio no existe: ${root}`);
  console.error(`  Pasa --dir con la carpeta de tu sitio. Si aun no hay nada construido,`);
  console.error(`  usa el comando sin --dir: solo enruta el brief y no cuesta nada.\n`);
  process.exit(2);
}
// Sin pagina web no es un error: es otro dominio. Se verifica con las puertas del proyecto.
const esWeb = existsSync(join(root, page));
if (!esWeb) {
  if (!jsonOut) {
    line(`\n  No hay ${page} en ${root} -> no es un proyecto web.`);
    line(`  Verificando con las puertas propias del proyecto (lint/typecheck/test/build).\n`);
  }
  const v = sh(node, [join(HERE, 'verify.mjs'), '--dir', root, ...(jsonOut ? ['--json'] : [])],
    { stdio: jsonOut ? 'pipe' : 'inherit' });
  if (jsonOut) { out.steps.verify = { exit: v.status }; out.exit = v.status; console.log(JSON.stringify(out, null, 2)); }
  else {
    line('='.repeat(62));
    line(v.status === 0 ? '  VEREDICTO: todas las puertas del proyecto pasan.'
       : v.status === 2 ? '  VEREDICTO: sin verificar. No hay puertas o falta la herramienta.\n  Eso no es un aprobado.'
       : '  VEREDICTO: BLOQUEADO.');
    line('='.repeat(62) + '\n');
  }
  process.exit(v.status || (routeFail ? 2 : 0));
}

// ---------- 1.5 preflight: Canva + Higgsfield ANTES de codigo ----------
// Modulo OPCIONAL: solo con --preflight (requiere conectores MCP de Canva y Higgsfield).
if (has('--preflight')) {   // solo aplica a plantillas de sitio web
  const pf = sh(node, [join(HERE, 'preflight.mjs'), '--dir', resolve(dir)], { stdio: jsonOut ? 'pipe' : 'inherit' });
  out.steps.preflight = { exit: pf.status };
  if (pf.status !== 0) {
    if (jsonOut) { out.exit = 1; console.log(JSON.stringify(out, null, 2)); }
    else line('  Para correr sin este modulo, quita --preflight\n');
    process.exit(1);
  }
} else if (!jsonOut) line('\n  [preflight desactivado: modulo opcional, usa --preflight para activarlo]\n');

// ---------- 2. servidor ----------

// playwright tiene que existir ANTES de levantar nada
try { import.meta.resolve('playwright'); }
catch { console.error('\n  ERROR: falta playwright: cd bin && npm ci\n'); process.exit(2); }

// liberar el puerto SOLO si lo ocupa un http.server nuestro (mismo cwd que el dir servido)
const ls = sh('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN']);
if (ls.error) { console.error(`\n  ERROR: no se pudo ejecutar lsof (${ls.error.code || ls.error.message}); instalalo para comprobar el puerto :${port}\n`); process.exit(2); }
const listeners = (ls.stdout || '').trim();
if (listeners) {
  for (const pid of listeners.split('\n')) {
    let ours = false;
    try {
      ours = realpathSync(`/proc/${pid}/cwd`) === realpathSync(root)
        && readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('http.server');
    } catch {}
    if (!ours) { console.error(`\n  ERROR: puerto ${port} ocupado por PID ${pid}, usa --port\n`); process.exit(2); }
    try { process.kill(+pid); } catch {}
  }
}

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid); } catch {} try { server.kill(); } catch {} };
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(130); });

// esperar a que sirva de verdad, sin sleep fijo
const url = `http://127.0.0.1:${port}/${page === 'index.html' ? '' : page}`;
let up = false;
for (let i = 0; i < 60; i++) {
  const c = sh('curl', ['-sf', '-o', '/dev/null', `http://127.0.0.1:${port}/`]);
  if (c.status === 0) { up = true; break; }
  sh('sleep', ['0.25']);
}
if (!up) { console.error(`  ERROR: el servidor no respondio en :${port}`); stop(); process.exit(2); }

// ---------- 3. puertas ----------
const qaOut = join(root, 'qa-out');
const runQa = () => sh(node, [join(HERE, 'scroll-qa.mjs'), url, '--out', qaOut, '--shots', shots, '--mobile'],
  { stdio: jsonOut ? 'pipe' : 'inherit' });
let qa = runQa();

// La long task de arranque depende de la carga de la maquina, no solo de la pagina:
// medido 57ms, 64ms y >200ms en la MISMA pagina segun lo ocupado que estuviera el contenedor.
// Si lo unico que falla es boot/*, se vuelve a medir una vez antes de bloquear.
if (qa.status !== 0) {
  let onlyBoot = false;
  try {
    const rep = JSON.parse(readFileSync(join(qaOut, 'report.json'), 'utf8'));
    const failed = rep.gates.filter(g => !g.pass);
    onlyBoot = failed.length > 0 && failed.every(g => g.name.startsWith('boot/'));
  } catch {}
  if (onlyBoot) {
    if (!jsonOut) line('\n  [solo fallo boot/* — puede ser carga de la maquina. Repitiendo una vez...]\n');
    qa = runQa();
    out.steps.bootRetry = true;
  }
}
out.steps.scrollQa = { exit: qa.status, out: qaOut };
const causas = [];
if (qa.status !== 0) { exitCode = qa.status === 2 ? 2 : 1; if (qa.status === 2) causas.push('scroll-qa no pudo medir'); }

// ---------- 4. rubrica ----------
const rb = sh(node, [join(HERE, 'rubric.mjs'), url], { stdio: jsonOut ? 'pipe' : 'inherit' });
out.steps.rubric = { exit: rb.status };
if (rb.status === 1) exitCode = 1;
if (rb.status === 2) { causas.push('pagina no puntuable (contenido insuficiente)'); if (exitCode === 0) exitCode = 2; }

// ---------- 4.5 web con build ----------
if (existsSync(join(root, 'package.json'))) {
  if (!jsonOut) line('\n  web con build: se midio el fuente, no dist/\n');
  out.steps.buildWarning = 'web con build: se midio el fuente, no dist/';
  const v = sh(node, [join(HERE, 'verify.mjs'), '--dir', root], { stdio: jsonOut ? 'pipe' : 'inherit' });
  out.steps.verify = { exit: v.status };
  if (v.status === 1) exitCode = 1;
  if (v.status === 2) { causas.push('verify sin evidencia (sin tests ejecutados, herramienta ausente o proyecto no reconocido)'); if (exitCode === 0) exitCode = 2; }
}
if (routeFail) { causas.push('skill-audit fallo'); if (exitCode === 0) exitCode = 2; }

stop();

// ---------- veredicto ----------
if (jsonOut) { out.exit = exitCode; console.log(JSON.stringify(out, null, 2)); }
else {
  line('='.repeat(62));
  if (exitCode === 0) {
    line('  VEREDICTO: pasa lo medible.');
    line(`  AHORA MIRA LAS CAPTURAS: ${qaOut}`);
    line('  Verde con la pagina en blanco sigue siendo un fallo.');
  } else if (exitCode === 2) {
    line('  VEREDICTO: no verificado. Causa: ' + (causas.join('; ') || 'desconocida') + '.');
  } else {
    line('  VEREDICTO: BLOQUEADO. Arregla lo que sale arriba y vuelve a correr.');
  }
  line('='.repeat(62) + '\n');
}
process.exit(exitCode);
