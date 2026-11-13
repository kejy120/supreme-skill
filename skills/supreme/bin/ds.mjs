#!/usr/bin/env node
// ds.mjs - los design systems viven fuera de las skills globales para no pagar sus ~2.500 tokens
// en toda sesion. Esto los lleva al proyecto donde de verdad estas construyendo.
//
//   node ds.mjs                          lista los disponibles
//   node ds.mjs bento --into ./mi-web    copia ese a ./mi-web/.agents/skills/
//   node ds.mjs bento neon --into .      varios a la vez
//   node ds.mjs --grep glass             busca por nombre o descripcion

import { readdirSync, existsSync, mkdirSync, cpSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const STORE = process.env.DS_STORE || join(homedir(), '.agents', 'design-systems');
const argv = process.argv.slice(2);
const opt = (f, d) => { const i = argv.indexOf(f); return i === -1 ? d : argv[i + 1]; };

if (!existsSync(STORE)) {
  console.error(`  No existe el almacen: ${STORE}\n  Ajusta DS_STORE si lo moviste.`);
  process.exit(2);
}

const desc = n => {
  const f = join(STORE, n, 'SKILL.md');
  const t = readFileSync(f, 'utf8'); const e = t.indexOf('\n---', 3);
  const m = t.slice(0, e + 4).match(/\ndescription:([\s\S]*?)(?=\n[a-zA-Z_-]+:\s|\n---)/);
  return (m ? m[1] : '').replace(/\s+/g, ' ').replace(/^["']|["']$/g, '').trim();
};
const all = readdirSync(STORE).filter(n => existsSync(join(STORE, n, 'SKILL.md')));

const grep = opt('--grep', null);
const into = opt('--into', null);
const names = argv.filter(a => !a.startsWith('--') && a !== into && a !== grep);

if (grep || !names.length) {
  const q = (grep || '').toLowerCase();
  const hits = all.filter(n => !q || n.includes(q) || desc(n).toLowerCase().includes(q));
  console.log(`\n  ${hits.length}/${all.length} design systems en ${STORE}\n`);
  for (const n of hits) {
    const tok = Math.round(statSync(join(STORE, n, 'SKILL.md')).size / 3.6);
    console.log(`  ${n.padEnd(18)} ${String(tok).padStart(5)} tok  ${desc(n).slice(0, 72)}`);
  }
  console.log(`\n  Para usar uno:  node ds.mjs <nombre> --into ./tu-proyecto\n`);
  process.exit(0);
}

if (!into) { console.error('  Falta --into <directorio del proyecto>'); process.exit(2); }

const dest = join(resolve(into), '.agents', 'skills');
mkdirSync(dest, { recursive: true });
let n = 0;
for (const name of names) {
  const src = join(STORE, name);
  if (!existsSync(join(src, 'SKILL.md'))) { console.error(`  no existe: ${name}`); continue; }
  cpSync(src, join(dest, name), { recursive: true });
  console.log(`  ${name} -> ${join(dest, name)}`);
  n++;
}
console.log(`\n  ${n} copiado(s). Reinicia la sesion en ese proyecto para que se descubran.\n`);
process.exit(n ? 0 : 2);
