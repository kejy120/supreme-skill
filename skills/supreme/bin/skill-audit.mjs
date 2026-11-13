#!/usr/bin/env node
// skill-audit.mjs - inventaria y enruta el repositorio de skills del usuario.
// Nada mas auditaba el propio repo de skills: ask-matt solo enruta las ~35 de mattpocock
// y ademas esta en disable-model-invocation, asi que no se activa sola.
//
//   node skill-audit.mjs                      inventario + solapamientos + huecos
//   node skill-audit.mjs "landing con scroll"  que skills aplican a ese encargo
//   node skill-audit.mjs --gaps                solo el informe de cobertura
//   node skill-audit.mjs ... --json

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Escanea AMBOS ambitos: las globales y las del proyecto en el que estas.
// dejaba al enrutador ciego justo para lo que mas falta hace al disenar.
const ROOTS = [];
if (process.env.SKILLS_DIR) ROOTS.push({ dir: process.env.SKILLS_DIR, scope: 'env' });
else {
  ROOTS.push({ dir: join(homedir(), '.agents', 'skills'), scope: 'global' });
  let d = process.cwd();
  for (let i = 0; i < 8; i++) {
    const c = join(d, '.agents', 'skills');
    if (existsSync(c) && c !== ROOTS[0].dir) ROOTS.push({ dir: c, scope: 'proyecto' });
    const up = join(d, '..'); if (up === d) break; d = up;
  }
}
const ROOT = ROOTS.map(r => r.dir).join(' + ');
const argv = process.argv.slice(2);
const jsonOut = argv.includes('--json');
const gapsOnly = argv.includes('--gaps');
const bi = argv.indexOf('--budget');
const BUDGET = bi >= 0 ? Number(argv[bi + 1]) || 12000 : 12000;
const brief = argv.filter((a, i) => !a.startsWith('--') && !(bi >= 0 && i === bi + 1)).join(' ').trim();

// Sin tildes ni mayusculas: "cotización" y "cotizacion" son el mismo encargo.
const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const STOP = new Set(('para como esta este esto sobre hazme quiero necesito favor puedes hacer unas unos '
  + 'tiene tienen desde entre pero porque cuando donde with that this from have into your what when will '
  + 'make please want need about them they').split(' '));

// ---------- leer el repo ----------
function frontmatter(text) {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const head = text.slice(3, end).replace(/\r/g, '');
  const out = {};
  let key = null;
  for (const raw of head.split('\n')) {
    const m = raw.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    // Descripciones multilinea: "key: >" / "|" (con - o +) son solo el indicador; el texto va en las lineas siguientes.
    if (m) { key = m[1]; out[key] = /^[>|][+-]?$/.test(m[2].trim()) ? '' : m[2].replace(/^["']|["']$/g, '').trim(); }
    else if (key && /^\s+\S/.test(raw)) out[key] += ' ' + raw.trim();
  }
  return out;
}

const skills = [];
const seen = new Set();
for (const { dir: RD, scope } of ROOTS) {
if (!existsSync(RD)) continue;
for (const name of readdirSync(RD)) {
  if (seen.has(name)) continue;           // el ambito mas cercano gana
  const f = join(RD, name, 'SKILL.md');
  if (!existsSync(f)) continue;
  seen.add(name);
  const text = readFileSync(f, 'utf8');
  const fm = frontmatter(text);
  const body = text.slice(Math.max(0, text.indexOf('\n---', 3)));
  skills.push({
    name,
    fmName: fm.name || name,
    desc: (fm.description || '').replace(/\s+/g, ' ').trim(),
    bytes: statSync(f).size,
    actTok: Math.round(statSync(f).size / 3.6),   // coste en tokens al activarse
    body: norm(body),
    nd: norm(name + ' ' + (fm.description || '').replace(/\s+/g, ' ')),   // solo nombre+descripcion
    haystack: norm(name + ' ' + (fm.description || '') + ' ' + body.slice(0, 6000)),
    hasScripts: existsSync(join(RD, name, 'scripts')) || existsSync(join(RD, name, 'bin')),
    hasRefs: existsSync(join(RD, name, 'references')),
    scope,
  });
}
}

// ---------- capacidades, todos los dominios ----------
// Antes solo cubria diseno web. Un orquestador que solo enruta un dominio no es un orquestador.
const CAPS = {
  // --- web / frontend ---
  'scroll-driven':      ['scrolltrigger','scroll-driven','scroll driven','scroll-linked','pinning','scrub','scroll','desplazamiento','anclado'],
  'smooth-scroll':      ['lenis','smooth scroll','locomotive','momentum scroll','suave','inercia'],
  'gsap':               ['gsap','greensock','tween','animacion','animaciones'],
  'motion-react':       ['framer-motion','framer motion','motion/react','react-spring','react','movimiento'],
  '3d-webgl':           ['three.js','threejs','webgl','react-three-fiber','r3f','babylon','playcanvas','3d','escena'],
  'easing-system':      ['cubic-bezier','easing','spring','damping','stiffness','curva','curvas','transicion'],
  'page-transitions':   ['view transition','barba','page transition','route transition','transiciones','ruta','rutas'],
  'text-animation':     ['splittext','split text','text reveal','typewriter','texto','titular'],
  'micro-interaction':  ['hover','press','gesture','drag','swipe','haptic','microinteraccion','gesto','arrastrar'],
  'reduced-motion':     ['prefers-reduced-motion','reduced motion','movimiento reducido'],
  'design-system':      ['design token','type scale','spacing scale','palette','color token','sistema de diseno','paleta','tipografia','espaciado'],
  'image-direction':    ['image generation','imagegen','art direction','photograph','imagen','imagenes','fotografia','direccion de arte'],
  // --- ingenieria ---
  'testing':            ['test-driven','tdd','unit test','integration test','pytest','vitest','jest','coverage','test','tests','prueba','pruebas','cobertura','flaky','intermitente'],
  'debugging':          ['debug','root cause','stack trace','reproduce','bisect','regression','bug','fallo','exception','traceback','regresion','depurar','depuracion','intermitente','causa raiz','debugging','flaky'],
  'refactor':           ['refactor','extract','consolidate','rename','dead code','simplify','refactorizar','limpiar','simplificar','codigo muerto'],
  'architecture':       ['architecture','module boundary','coupling','domain model','layering','arquitectura','acoplamiento','modulo','capas','dominio'],
  'migration':          ['migration','schema change','backfill','rollback','compatibility','migracion','migrar','esquema'],
  'code-review':        ['code review','pull request','diff review','pr feedback','revision de codigo','revisar el codigo','pr'],
  'perf-budget':        ['will-change','compositor','fps','long task','layout thrash','profiling','benchmark','rendimiento','lento','optimizar','perfilado','presupuesto'],
  'security':           ['vulnerability','injection','xss','csrf','secret','authz','authn','owasp','seguridad','vulnerabilidad','inyeccion','secreto','secretos','auditar la seguridad','security'],
  'backend':            ['api design','endpoint','database','sql','orm','cache','queue','microservice','api','base de datos','consulta','cola'],
  'data':               ['dataframe','etl','pipeline','clickhouse','analytics','query plan','datos','analitica','informe'],
  'infra-ci':           ['github actions','pipeline','docker','deploy','ci/cd','workflow file','despliegue','desplegar','contenedor','integracion continua'],
  'git-workflow':       ['worktree','branch','rebase','merge conflict','commit message','conventional commit','rama','ramas','commit','conflicto','fusion'],
  // --- proceso y salida ---
  'planning':           ['spec','roadmap','requirement','breakdown','planificar','especificacion','ticket','tickets','tarea','tareas','alcance','desglosar'],
  'verification':       ['verify','acceptance criteria','definition of done','gate','regression check','verificar','verificacion','aceptacion','comprobar'],
  'orchestration':      ['subagent','parallel agent','delegate','dispatch','subagente','subagentes','delegar','paralelo'],
  'docs':               ['documentation','readme','docstring','jsdoc','changelog','adr','documentacion','documentar'],
  'writing':            ['copywriting','microcopy','tone of voice','headline','editing','draft','redactar','redaccion','escribir','copy','tono'],
  'token-economy':      ['compress','token','context window','compact','prompt size','tokens','contexto','comprimir','compactar','ahorro','ahorrar'],
  'skill-authoring':    ['writing skills','skill.md','agents.md','claude.md','system prompt','skill','skills','prompt','instrucciones'],
  'accessibility':      ['wcag','aria','contrast','keyboard','focus visible','screen reader','accesibilidad','contraste','teclado','lector de pantalla'],
  // --- contenido social y video (tanda 2026-09-26) ---
  'hook-copy':          ['hook','opening line','scroll stopper','attention grabber','gancho','primera linea','enganche'],
  'miniaturas':         ['thumbnail','thumbnails','miniatura','miniaturas','portada','caratula'],
  'video-analisis':     ['transcript','transcripcion','extract hooks','analizar','analiza','analizame','subtitulos','ver el video'],
  'research-social':    ['trending','viral','outlier','tendencia','tendencias','competidor','competidores','competitor content','que estan publicando'],
  'investigacion-web':  ['internet','reddit','resenas','resena','reviews','review de','foro','foros','hilo','hilos','thread','rss','buscar en internet','busca en internet','buscar en la web','que dice la gente','opiniones','investigar en internet','investiga en internet'],
  'plan-contenido':     ['content plan','content calendar','content strategy','plan de contenido','calendario de contenido','estrategia de contenido','que publico','que publicamos','calendario editorial'],
  'guion-video':        ['reel script','video script','guion','guionizar','beat by beat','storyboard','escaleta'],
  'caption-hashtags':   ['caption','hashtag','hashtags','pie de foto','descripcion del post','etiquetas'],
  'cta-conversion':     ['call to action','cta','llamada a la accion','conversion','lead magnet','dm script'],
  'carrusel-stories':   ['carousel','carrusel','slides','diapositivas','story','stories','historias'],
  'audiencia-persona':  ['persona','personas','audiencia','buyer persona','publico objetivo','segmento'],
  'competencia':        ['competitor','competition','competencia','competidor','competidores','rival','rivales','teardown','benchmark','posicionamiento','positioning'],
  'creadores-ugc':      ['ugc','creator brief','influencer','colaboracion','collab','brief para creador'],
  'paid-analytics':     ['paid social','ads','anuncios','utm','attribution','atribucion','analytics','metricas','retrospectiva'],
  'repurpose':          ['repurpose','repurposing','reutilizar','reciclar contenido','atomizar','cross-post','crossposting','adaptar a otra plataforma'],
  // --- negocio (tanda 2026-09-26) ---
  'propuesta-venta':    ['proposal','quote','estimate','pitch','propuesta','cotizacion','presupuesto','oferta','propuestas','cotizaciones','presupuestos'],
  'cobro-pagos':        ['invoice','payment reminder','dunning','factura','facturas','cobrar','cobro','impago','moroso','morosidad','recordatorio de pago'],
  'voz-de-marca':       ['brand voice','tone of voice','copy rewrite','tono','voz de marca','reescribir','copy','suene como'],
  'actas-reuniones':    ['meeting notes','action items','minutes','acta','minuta','notas de reunion','siguientes pasos','llamada'],
  'catalogo-producto':  ['product listing','catalog entry','listing','ficha','fichas','ficha de producto','catalogo','descripcion de producto','publicacion de venta'],
  'audit-redesign':     ['audit','redesign','critique','review','overengineering','yagni','auditar','auditoria','redisenar','rediseno','sobreingenieria','criticar'],
};

// Dominio del encargo -> que verificador aplica. Sin esto, "verificar" solo significaba web.
const DOMAIN_VERIFIER = {
  web:     { caps: ['scroll-driven','smooth-scroll','gsap','motion-react','3d-webgl','design-system','page-transitions','micro-interaction','reduced-motion','text-animation','easing-system','image-direction'],
             cmd: 'bin/run.mjs --dir <sitio>', que: 'puertas de scroll + rubrica de diseno en Chromium real' },
  codigo:  { caps: ['testing','debugging','refactor','architecture','migration','backend','data','perf-budget','security','infra-ci'],
             cmd: 'bin/verify.mjs --dir <proyecto>', que: 'lint + typecheck + tests + build reales del proyecto' },
  proceso: { caps: ['planning','verification','orchestration','docs','writing','skill-authoring','token-economy','git-workflow','code-review','audit-redesign','accessibility',
            'propuesta-venta','cobro-pagos','voz-de-marca','actas-reuniones','catalogo-producto',
            'hook-copy','miniaturas','video-analisis','research-social','plan-contenido','investigacion-web',
            'guion-video','caption-hashtags','cta-conversion','carrusel-stories','audiencia-persona',
            'competencia','creadores-ugc','paid-analytics','repurpose'],
             cmd: 'bin/verify.mjs --dir <carpeta>', que: 'se verifica con .supreme/criterios.json (higiene + criterios); sin ese archivo queda NO VERIFICADO' },
};

const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (hay, needle) => new RegExp(`(^|[^a-z0-9])${esc(needle)}([^a-z0-9]|$)`, 'i').test(hay);
for (const c of Object.keys(CAPS)) CAPS[c] = [...new Set(CAPS[c].map(norm))];
// Huecos y cobertura: solo nombre+descripcion (el cuerpo inflaba: cualquier skill larga "cubria" todo).
const capIndex = {};
for (const [cap, kws] of Object.entries(CAPS)) {
  capIndex[cap] = skills
    .map(s => ({ s, hits: kws.filter(k => hasWord(s.nd, k)).length }))
    .filter(x => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map(x => ({ name: x.s.name, hits: x.hits }));
}

// ---------- solapamientos: descripciones casi identicas ----------
const tok = s => new Set(norm(s.desc).match(/[a-z]{4,}/g) || []);
const jac = (a, b) => { const i = [...a].filter(x => b.has(x)).length; return i / (a.size + b.size - i || 1); };
const overlaps = [];
for (let i = 0; i < skills.length; i++) {
  for (let j = i + 1; j < skills.length; j++) {
    const a = tok(skills[i]), b = tok(skills[j]);
    if (a.size < 6 || b.size < 6) continue;
    const sim = jac(a, b);
    if (sim > 0.55) overlaps.push({ a: skills[i].name, b: skills[j].name, sim: +sim.toFixed(2) });
  }
}
overlaps.sort((x, y) => y.sim - x.sim);

// ---------- enrutado de un brief ----------
function route(text) {
  const q = norm(text);
  const qTokens = (q.match(/[a-z]{4,}/g) || []).filter(w => !STOP.has(w));
  // Frontera de palabra tambien aqui: con includes() suelto, el token "esta" puntuaba
  // +6 en la skill "propu-esta-s" y le ganaba a tiktok-research en un brief de TikTok.
  const escR = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordIn = (hay, needle) => new RegExp(`(^|[^a-z0-9])${escR(needle)}([^a-z0-9]|$)`, 'i').test(hay);
  const scored = skills.filter(s => s.name !== 'supreme').map(s => {   // el orquestador no se propone a si mismo
    let score = 0;
    for (const t of qTokens) {
      if (wordIn(s.name.replace(/-/g, ' '), t)) score += 6;
      if (wordIn(s.nd, t)) score += 3;
      else if (wordIn(s.haystack, t)) score += 1;
    }
    return { name: s.name, score, scope: s.scope, desc: s.desc.slice(0, 110) };
  });

  // Frontera de palabra obligatoria. Con includes() suelto, "partirla" activaba
  // image-direction por contener "art", y "escanear" activaba "can". Falsos positivos reales.
  const caps = Object.entries(CAPS)
    // Se quito la via "primera palabra de una frase clave": con ella, el generico
    // "video" activaba video-analisis via 'video analysis' y sus +8 tapaban a miniaturas.
    .filter(([, kws]) => kws.some(k => hasWord(q, k) ||
                                       // Solo contra palabras clave de UNA palabra: si no, el token
                                       // generico "video" activaba video-analisis por estar dentro de
                                       // "video analysis", y le robaba el turno a miniaturas.
                                       (!k.includes(' ') && qTokens.some(t => t.length >= 4 && hasWord(k, t)))))
    .map(([c]) => c);

  // Puente idioma: la capacidad se detecta en español y se propaga a las skills que la
  // cubren aunque su descripcion este en ingles. "miniatura" -> cap miniaturas -> thumbnail.
  const byName2 = Object.fromEntries(skills.map(x => [x.name, x]));
  for (const c of caps) {
    // Tope por capacidad (8 nombre + 3 descripcion): sin el, una capacidad con muchas claves
    // (testing) se comia el top y sacaba a las skills de las otras (debugging).
    const add = new Map(scored.map(r => [r, 0]));
    for (const kw of CAPS[c]) {
      for (const r of scored) {
        const sk = byName2[r.name];
        if (!sk) continue;
        const nm = sk.name.replace(/-/g, ' ');
        // Frase de varias palabras: subcadena basta y evita fallar por sufijo
        // ("content plan" no casaba en "content planner" exigiendo frontera).
        const hitName = kw.includes(' ') ? nm.includes(kw) : wordIn(nm, kw);
        const dn = norm(sk.desc);
        // +8, no +5: una skill cuyo NOMBRE es la capacidad pedida tiene que ganarle
        // a otra que solo comparte un token generico ("video" en "miniatura del video").
        if (hitName) add.set(r, add.get(r) + 8);
        else if (kw.includes(' ') ? dn.includes(kw) : wordIn(dn, kw)) add.set(r, add.get(r) + 3);
      }
    }
    for (const [r, v] of add) r.score += Math.min(v, 11);
  }
  const scoredF = scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score);

  const byName = Object.fromEntries(skills.map(s => [s.name, s]));
  const preguntar = caps.length === 0;
  // Sin capacidades no hay base para enrutar: nunca se proponen skills gordas (>5k tok).
  const ranked = scoredF.map(r => ({ ...r, tok: byName[r.name].actTok })).filter(r => !preguntar || r.tok <= 5000);
  // Alternativa barata por relevancia/tok (NO es cobertura; el conjunto por cobertura es "magro").
  const cheap = ranked.slice(0, 20).slice().sort((a, b) => (b.score / Math.sqrt(b.tok)) - (a.score / Math.sqrt(a.tok)));

  // MAGRO por cobertura. Universo = capacidades detectadas en el brief. Una skill cubre c si su
  // nombre o descripcion contiene una clave de CAPS[c]. Voraz por (caps nuevas / tokens).
  // Cubre c si el NOMBRE contiene una clave, o la descripcion contiene >=2 claves DISTINTAS
  // (una mencion de pasada, p.ej. "integra con GSAP", no basta).
  const covers = r => {
    const sk = byName[r.name];
    return caps.filter(c => CAPS[c].some(k => hasWord(sk.name, k)) ||
                            CAPS[c].filter(k => hasWord(sk.nd.slice(sk.name.length), k)).length >= 2);
  };
  const top1 = ranked.length ? ranked[0].score : 0;
  const sum = l => l.reduce((a, r) => a + r.tok, 0);
  let magro = [], covered = new Set(), notas = [], cands = [];
  const select = frac => {
    const minRel = Math.max(6, frac * top1);
    cands = ranked.filter(r => r.score >= minRel).map(r => ({ ...r, cov: covers(r) })).filter(r => r.cov.length);
    const pool = cands.filter(r => r.tok <= BUDGET);
    let sel = [], cov = new Set(), used = 0;
    while (sel.length < 5) {
      let best = null, bestV = 0;
      for (const r of pool) {
        if (sel.includes(r) || used + r.tok > BUDGET) continue;
        const gain = r.cov.filter(c => !cov.has(c)).length;
        if (!gain) continue;
        // valor = nuevas x (relevancia / relevancia de la 1a) / sqrt(tokens)
        const v = gain * (r.score / top1) / Math.sqrt(r.tok);
        if (!best || v > bestV || (v === bestV && r.score > best.score)) { best = r; bestV = v; }
      }
      if (!best) break;
      sel.push(best); used += best.tok; best.cov.forEach(c => cov.add(c));
      if (cov.size === caps.length) break;
    }
    // Mejor skill unica dentro del presupuesto: gana si cubre mas; empate, la mas barata.
    const single = pool.slice().sort((x, y) => y.cov.length - x.cov.length || x.tok - y.tok || y.score - x.score)[0];
    if (single && (single.cov.length > cov.size || (single.cov.length === cov.size && single.tok < sum(sel)))) {
      sel = [single]; cov = new Set(single.cov);
    }
    return { sel, cov };
  };
  if (!preguntar) {
    let r = select(0.30);
    // Si el magro arrastra una skill poco relevante (<0.40 de la 1a), subir el umbral a 0.40.
    if (r.sel.some(x => x.score < 0.40 * top1)) r = select(0.40);
    magro = r.sel; covered = r.cov;
    for (const c of caps) {
      if (covered.has(c)) continue;
      const cs = cands.filter(r => r.cov.includes(c));
      if (cs.length === 1 && cs[0].tok > BUDGET) notas.push(`cap ${c}: solo ${cs[0].name} (${cs[0].tok} tok), confirmar`);
    }
  }
  // que dominio domina el encargo
  const score = {};
  for (const [d, v] of Object.entries(DOMAIN_VERIFIER))
    score[d] = caps.filter(c => v.caps.includes(c)).length;
  const domain = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return { top: ranked.slice(0, 14), cheap: cheap.slice(0, 5),
           magro: magro.map(r => ({ name: r.name, tok: r.tok, score: r.score, cubre: r.cov })),
           sinCubrir: caps.filter(c => !covered.has(c)), notas, preguntar, budget: BUDGET, capsDetected: caps,
           domain: domain[1] > 0 ? domain[0] : null, verifier: domain[1] > 0 ? DOMAIN_VERIFIER[domain[0]] : null };
}

const report = {
  root: ROOT,
  total: skills.length,
  withScripts: skills.filter(s => s.hasScripts).length,
  withRefs: skills.filter(s => s.hasRefs).length,
  biggest: skills.slice().sort((a, b) => b.bytes - a.bytes).slice(0, 5)
    .map(s => ({ name: s.name, kb: Math.round(s.bytes / 1024) })),
  coverage: Object.fromEntries(Object.entries(capIndex)
    .map(([c, list]) => [c, { count: list.length, top: list.slice(0, 4).map(x => x.name) }])),
  gaps: Object.entries(capIndex).filter(([, l]) => l.length === 0).map(([c]) => c),
  thin: Object.entries(capIndex).filter(([, l]) => l.length > 0 && l.length <= 2).map(([c, l]) => ({ cap: c, only: l.map(x => x.name) })),
  overlaps: overlaps.slice(0, 12),
  routed: brief ? route(brief) : null,
};

if (jsonOut) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

const bar = (n, max = 20) => '#'.repeat(Math.min(n, max));
console.log(`\n  skill-audit  ${ROOT}`);
const byScope = {};
for (const s2 of skills) byScope[s2.scope] = (byScope[s2.scope] || 0) + 1;
console.log(`  ${report.total} skills (${Object.entries(byScope).map(([k, v]) => `${v} ${k}`).join(' + ')}) · ${report.withScripts} con scripts\n`);

if (!brief || gapsOnly) {
  console.log('  COBERTURA POR CAPACIDAD');
  for (const [cap, v] of Object.entries(report.coverage)) {
    const flag = v.count === 0 ? ' <-- HUECO' : v.count <= 2 ? ' <-- fino' : '';
    console.log(`    ${cap.padEnd(20)} ${String(v.count).padStart(3)} ${bar(v.count)}${flag}`);
    if (v.count && v.count <= 4) console.log(`    ${''.padEnd(20)}     ${v.top.join(', ')}`);
  }
  if (report.gaps.length) console.log(`\n  SIN COBERTURA: ${report.gaps.join(', ')}`);
  if (report.overlaps.length) {
    console.log('\n  SOLAPAMIENTOS (descripciones casi iguales — candidatas a podar)');
    for (const o of report.overlaps) console.log(`    ${o.sim}  ${o.a}  <->  ${o.b}`);
  }
  console.log('\n  MAS PESADAS (coste al activarse)');
  for (const b of report.biggest) console.log(`    ${String(b.kb).padStart(4)} KB  ${b.name}`);
}

if (brief) {
  console.log(`\n  ENCARGO: "${norm(brief)}"`);
  if (report.routed.capsDetected.length)
    console.log(`  capacidades detectadas: ${report.routed.capsDetected.join(', ')}`);
  if (report.routed.verifier)
    console.log(`  dominio: ${report.routed.domain}  ->  verificar con: ${report.routed.verifier.cmd}\n  (${report.routed.verifier.que})`);
  else
    console.log('  dominio: no determinado — describe el encargo con terminos mas tecnicos');
  console.log('\n  SKILLS QUE APLICAN            coste al activarse');
  for (const r of report.routed.top)
    console.log(`    ${String(r.score).padStart(3)}  ${r.name.padEnd(26)}${r.scope === 'proyecto' ? '*' : ' '} ${String(r.tok).padStart(5)} tok  ${r.desc.slice(0, 54)}`);

  const R = report.routed;
  const naive = R.top.slice(0, 5).reduce((a, r) => a + r.tok, 0);
  if (R.preguntar) {
    console.log('\n  CONJUNTO MAGRO: ninguno (no se detecto ninguna capacidad)');
    console.log('  -> una pregunta al usuario: que quiere conseguir exactamente (tipo de pieza, tecnologia, objetivo). No actives skills a ciegas.');
  } else {
    const lean = R.magro.reduce((a, r) => a + r.tok, 0);
    console.log(`\n  CONJUNTO MAGRO (cobertura de las capacidades detectadas, presupuesto ${R.budget} tok)`);
    for (const r of R.magro) console.log(`    ${String(r.tok).padStart(6)} tok  ${r.name.padEnd(26)} cubre: ${r.cubre.join(', ')}`);
    if (!R.magro.length) console.log('    (ninguna skill candidata cubre dentro del presupuesto)');
    for (const n of R.notas) console.log('  ' + n);
    console.log(`\n  top-5 por relevancia: ${naive} tok  ·  magro: ${lean} tok  ·  ahorro ${naive - lean} tok`);
    if (R.sinCubrir.length) console.log(`  sin cubrir por el magro: ${R.sinCubrir.join(', ')}`);
  }
  const missing = R.capsDetected.filter(c => capIndex[c].length === 0);
  if (missing.length) {
    console.log(`\n  FALTA COBERTURA PARA: ${missing.join(', ')}`);
    console.log('  -> propon al usuario que instale una skill para esto. NO la instales tu solo.');
  }
}
console.log('');
