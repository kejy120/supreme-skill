#!/usr/bin/env node
// scroll-qa.mjs - puertas de calidad medidas en un Chromium real.
// Uso: node scroll-qa.mjs <url|archivo.html> [--out DIR] [--shots N] [--viewport WxH] [--mobile] [--json]
// Sale con codigo !=0 si falla cualquier puerta. Una puerta que nunca falla no es una puerta.
//
// Tres cosas que aprendi midiendo de verdad y que condicionan el diseno de este script:
//  1. El scroll programatico NO marca hadRecentInput, asi que los pin-spacer de ScrollTrigger
//     se contarian como CLS. El CLS solo es honesto medido en la fase de carga -> se congela
//     el contador antes de empezar a conducir.
//  2. GSAP no usa la Web Animations API: document.getAnimations() devuelve 0 con 9 tweens vivos.
//     Hay que leer gsap.globalTimeline y ScrollTrigger.getAll() aparte.
//  3. Lenis registra a proposito un listener de scroll no-passive. Culpar a la pagina por eso
//     es un falso positivo -> se atribuye cada listener a su script de origen.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('falta playwright: cd bin && npm ci'); process.exit(2); }

const argv = process.argv.slice(2);
if (!argv[0] || argv.includes('--help')) {
  console.log(`scroll-qa.mjs <url|archivo.html> [opciones]

  --out DIR        capturas + report.json            (def: ./qa-out)
  --shots N        posiciones de scroll a capturar   (def: 5)
  --viewport WxH   viewport                          (def: 1440x900)
  --mobile         anade pasada 390x844; ambas deben pasar
  --json           solo JSON por stdout
  --no-gates       mide y reporta, pero NO es una verificacion: sale 2

Umbrales (env):
  QA_MIN_FPS=50        fps mediano durante el scroll
  QA_MAX_LONGTASK=50   ms; long task maxima DURANTE EL SCROLL
  QA_MAX_BOOT=200      ms; long task maxima en la fase de carga
  QA_MAX_CLS=0.1       CLS de la fase de carga
  QA_ALLOW_NONCOMP=0   propiedades animadas que fuerzan layout`);
  process.exit(argv[0] ? 0 : 2);
}

const opt = (f, d) => { const i = argv.indexOf(f); return i === -1 ? d : argv[i + 1]; };
const has = (f) => argv.includes(f);

const target = argv[0];
const url = /^https?:\/\//.test(target) ? target : pathToFileURL(resolve(target)).href;
const outDir = resolve(opt('--out', 'qa-out'));
const shots = parseInt(opt('--shots', '5'), 10);
const [vw, vh] = opt('--viewport', '1440x900').split('x').map(Number);

const GATE = {
  minFps: +(process.env.QA_MIN_FPS ?? 50),
  maxLongTask: +(process.env.QA_MAX_LONGTASK ?? 50),
  maxBoot: +(process.env.QA_MAX_BOOT ?? 200),
  maxCls: +(process.env.QA_MAX_CLS ?? 0.1),
  allowNonComp: +(process.env.QA_ALLOW_NONCOMP ?? 0),
};

// Animables sin relayout. El resto de la lista LAYOUT_TRIGGERS si obliga a recalcular geometria.
const COMPOSITOR_SAFE = new Set(['transform','opacity','filter','backdrop-filter','rotate','scale',
  'translate','clip-path','offset-distance','offset-path','will-change','color','background-color',
  'border-color','outline-color','box-shadow','text-shadow','visibility','pointer-events','z-index',
  'cursor','fill','stroke','stroke-dashoffset','background-position','x','y','xPercent','yPercent']);
const LAYOUT_TRIGGERS = new Set(['width','height','top','left','right','bottom','margin','margin-top',
  'margin-left','margin-right','margin-bottom','padding','padding-top','padding-left','padding-right',
  'padding-bottom','font-size','line-height','letter-spacing','border-width','flex','flex-basis',
  'flex-grow','grid-template-columns','grid-template-rows','inset','max-width','max-height',
  'min-width','min-height','gap','row-gap','column-gap']);
// Librerias conocidas que registran listeners no-passive por diseno propio.
const KNOWN_LIBS = /lenis|locomotive|scrolltrigger|gsap|smooth-scrollbar|barba/i;

mkdirSync(outDir, { recursive: true });

const INSTRUMENT = `
window.__qa = { boot:{long:[],cls:0,shifts:0}, scroll:{long:[]}, phase:'boot', listeners:[], errors:[] };
try { new PerformanceObserver(l => { for (const e of l.getEntries())
        window.__qa[window.__qa.phase === 'boot' ? 'boot' : 'scroll'].long.push(Math.round(e.duration));
      }).observe({ type:'longtask', buffered:true }); } catch {}
try { new PerformanceObserver(l => { for (const e of l.getEntries()) {
        // Solo cuenta el CLS de la fase de carga: el scroll programatico no marca hadRecentInput
        // y haria pasar por CLS los pin-spacer que inserta ScrollTrigger.
        if (window.__qa.phase !== 'boot' || e.hadRecentInput) continue;
        window.__qa.boot.cls += e.value; window.__qa.boot.shifts++;
      } }).observe({ type:'layout-shift', buffered:true }); } catch {}
const _add = EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener = function (type, fn, o) {
  if (type === 'scroll' && (this === window || this === document)) {
    const passive = !!(o && typeof o === 'object' && o.passive);
    if (!passive) {
      const st = (new Error().stack || '').split('\\n').slice(1, 5).join(' | ');
      window.__qa.listeners.push({ stack: st });
    }
  }
  return _add.call(this, type, fn, o);
};
window.addEventListener('error', e => window.__qa.errors.push(String(e.message)));
`;

// Recolecta propiedades animadas de las TRES fuentes: WAAPI, CSSOM y el registro propio de GSAP.
const COLLECT = `(() => {
  const props = new Set(); const k2 = s => s.replace(/[A-Z]/g, m => '-' + m.toLowerCase());

  for (const a of (document.getAnimations?.() || [])) {
    let kf = []; try { kf = a.effect.getKeyframes(); } catch {}
    for (const f of kf) for (const p of Object.keys(f))
      if (!['offset','computedOffset','easing','composite'].includes(p)) props.add(k2(p));
  }

  const walk = rules => { for (const r of rules) { try {
    if (r.constructor.name === 'CSSKeyframesRule') {
      for (const kf of r.cssRules) for (let i = 0; i < kf.style.length; i++) props.add(kf.style[i]);
    } else if (r.style) {
      const tp = r.style.getPropertyValue('transition-property');
      if (tp && tp !== 'none') tp.split(',').forEach(p => { p = p.trim(); if (p && p !== 'all') props.add(p); });
      const tr = r.style.getPropertyValue('transition');
      if (tr) tr.split(',').forEach(s => { const f = s.trim().split(/\\s+/)[0];
        if (f && !/^[\\d.]/.test(f) && !['all','none'].includes(f)) props.add(f); });
    }
    if (r.cssRules) walk(r.cssRules);
  } catch {} } };
  for (const ss of document.styleSheets) { try { walk(ss.cssRules); } catch {} }

  // GSAP: no pasa por WAAPI. Sus tweens declaran las props en .vars
  let gsapTweens = 0, scrollTriggers = 0;
  try {
    if (window.gsap) {
      const ch = gsap.globalTimeline.getChildren(true, true, true);
      gsapTweens = ch.length;
      const SKIP = new Set(['duration','delay','ease','stagger','scrollTrigger','onComplete','onUpdate',
        'onStart','overwrite','repeat','yoyo','paused','immediateRender','data','id','callbackScope',
        'onReverseComplete','runBackwards','startAt','keyframes','inherit','lazy','onInterrupt']);
      for (const t of ch) for (const p of Object.keys(t.vars || {})) if (!SKIP.has(p)) props.add(k2(p));
    }
    if (window.ScrollTrigger) scrollTriggers = ScrollTrigger.getAll().length;
  } catch {}

  const cssAnims = document.querySelectorAll('*').length &&
    [...document.querySelectorAll('*')].filter(e => getComputedStyle(e).animationName !== 'none').length;

  return { props: [...props], gsapTweens, scrollTriggers,
           waapi: (document.getAnimations?.() || []).length, cssAnims };
})()`;

async function measure({ reducedMotion = null, viewport = { width: vw, height: vh }, tag = 'desktop' } = {}) {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let c, qa, fpsSamples = [], screenshots = [], consoleErrors = [];
  try {
  const ctx = await browser.newContext({ viewport, reducedMotion: reducedMotion ?? undefined, deviceScaleFactor: 1 });
  await ctx.addInitScript(INSTRUMENT);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => consoleErrors.push(String(e).slice(0, 200)));

  await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(900);                       // dejar asentar la carga
  await page.evaluate(() => { window.__qa.phase = 'scroll'; });  // congelar CLS de carga

  const scrollable = await page.evaluate((h) => Math.max(0,
    Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - h), viewport.height);

  
  for (let i = 0; i < shots; i++) {
    const frac = shots === 1 ? 0 : i / (shots - 1);
    const s = await page.evaluate(async (y) => {
      const y0 = window.scrollY, d = y - y0, DUR = 420, t0 = performance.now(), fr = [];
      await new Promise(res => { let last = t0; (function step(now) {
        fr.push(now - last); last = now;
        const p = Math.min(1, (now - t0) / DUR);
        window.scrollTo(0, y0 + d * p);
        p < 1 ? requestAnimationFrame(step) : res();
      })(t0); });
      const v = fr.filter(x => x > 0).sort((a, b) => a - b);
      return v.length ? Math.round(1000 / v[Math.floor(v.length / 2)]) : 0;
    }, Math.round(scrollable * frac));
    fpsSamples.push(s);
    await page.waitForTimeout(240);
    const name = `${tag}-${String(i).padStart(2, '0')}-${Math.round(frac * 100)}pct.png`;
    await page.screenshot({ path: `${outDir}/${name}` });
    screenshots.push(name);
  }

  c = await page.evaluate(COLLECT);
  qa = await page.evaluate(() => window.__qa);
  } finally { await browser.close().catch(() => {}); }

  const firstParty = qa.listeners.filter(l => !KNOWN_LIBS.test(l.stack));
  const libParty = qa.listeners.filter(l => KNOWN_LIBS.test(l.stack));

  return {
    tag, viewport,
    fps: { samples: fpsSamples, median: fpsSamples.slice().sort((a, b) => a - b)[Math.floor(fpsSamples.length / 2)] },
    bootLongTasks: qa.boot.long, worstBoot: qa.boot.long.length ? Math.max(...qa.boot.long) : 0,
    scrollLongTasks: qa.scroll.long, worstScroll: qa.scroll.long.length ? Math.max(...qa.scroll.long) : 0,
    cls: +qa.boot.cls.toFixed(4), layoutShifts: qa.boot.shifts,
    nonPassiveFirstParty: firstParty.length,
    nonPassiveLib: libParty.map(l => (l.stack.match(/\/([\w.@-]+\.js)(?=[:\s)])/) || [, 'lib'])[1]),
    animatedProps: c.props.sort(),
    nonCompositor: c.props.filter(p => LAYOUT_TRIGGERS.has(p)),
    motion: { waapi: c.waapi, gsapTweens: c.gsapTweens, scrollTriggers: c.scrollTriggers, cssAnims: c.cssAnims },
    motionSignal: c.waapi + c.gsapTweens + c.scrollTriggers + c.cssAnims,
    consoleErrors: [...new Set(consoleErrors)],
    screenshots,
  };
}

const runs = [await measure({ tag: 'desktop' })];
if (has('--mobile')) runs.push(await measure({ viewport: { width: 390, height: 844 }, tag: 'mobile' }));
const reduced = await measure({ reducedMotion: 'reduce', tag: 'reduced' });

const gates = [];
const push = (n, p, d) => gates.push({ name: n, pass: p, detail: d });

for (const r of runs) {
  push(`fps/${r.tag}`, r.fps.median >= GATE.minFps,
    `mediana ${r.fps.median}fps [${r.fps.samples.join(',')}] — umbral ${GATE.minFps}`);
  push(`jank-scroll/${r.tag}`, r.worstScroll <= GATE.maxLongTask,
    `peor long task durante scroll ${r.worstScroll}ms en ${r.scrollLongTasks.length} — umbral ${GATE.maxLongTask}ms`);
  push(`boot/${r.tag}`, r.worstBoot <= GATE.maxBoot,
    `peor long task en carga ${r.worstBoot}ms en ${r.bootLongTasks.length} — umbral ${GATE.maxBoot}ms`);
  push(`cls/${r.tag}`, r.cls <= GATE.maxCls,
    `CLS de carga ${r.cls} en ${r.layoutShifts} shifts — umbral ${GATE.maxCls}`);
  push(`compositor/${r.tag}`, r.nonCompositor.length <= GATE.allowNonComp,
    r.nonCompositor.length ? `fuerzan layout: ${r.nonCompositor.join(', ')}` : 'solo transform/opacity y afines');
  push(`scroll-listener/${r.tag}`, r.nonPassiveFirstParty === 0,
    r.nonPassiveFirstParty
      ? `${r.nonPassiveFirstParty} listener(s) no-passive en codigo propio`
      : `0 propios${r.nonPassiveLib.length ? ` (${[...new Set(r.nonPassiveLib)].join(',')} registra el suyo, es por diseno)` : ''}`);
  push(`console/${r.tag}`, r.consoleErrors.length === 0,
    r.consoleErrors.length ? r.consoleErrors.join(' | ') : 'sin errores');
  push(`hay-movimiento/${r.tag}`, r.motionSignal > 0,
    `waapi ${r.motion.waapi} · gsap ${r.motion.gsapTweens} · scrollTrigger ${r.motion.scrollTriggers} · css ${r.motion.cssAnims}`);
}

const base = runs[0];
const cut = reduced.motionSignal < base.motionSignal;
push('reduced-motion', cut,
  cut ? `senal de movimiento ${base.motionSignal} -> ${reduced.motionSignal} con prefers-reduced-motion`
      : `NO reacciona: senal ${base.motionSignal} identica con y sin prefers-reduced-motion`);

const failed = gates.filter(g => !g.pass);
writeFileSync(`${outDir}/report.json`,
  JSON.stringify({ url, when: new Date().toISOString(), thresholds: GATE, gates, runs, reduced }, null, 2));

if (has('--json')) {
  console.log(JSON.stringify({ url, gates, runs, reduced }, null, 2));
} else {
  console.log(`\n  scroll-qa  ${url}\n  capturas -> ${outDir}\n`);
  for (const g of gates) console.log(`  ${g.pass ? 'PASA ' : 'FALLA'}  ${g.name.padEnd(24)} ${g.detail}`);
  console.log(`\n  ${gates.length - failed.length}/${gates.length} puertas superadas`);
  console.log(failed.length ? `  BLOQUEADO: ${failed.map(f => f.name).join(', ')}\n`
                            : `  Todas pasan. Ahora MIRA las capturas: una puerta verde con la pagina en blanco sigue siendo un fallo.\n`);
}
if (has('--no-gates')) { console.log('  SIN PUERTAS: no es una verificacion'); process.exit(2); }
process.exit(failed.length ? 1 : 0);
