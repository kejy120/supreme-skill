#!/usr/bin/env node
// Auditor en bucle: vigila proyectos y, cuando cambian, los audita.
//
// En cada vuelta, por proyecto:
//   1. Huella del proyecto (git HEAD + git status, o mtimes si no es repo).
//      Si no cambió desde la última auditoría, se salta.
//   2. Verificación real: supreme/bin/verify.mjs --dir <proyecto>.
//      Exit 0 = PASS, cualquier otro = FAIL (exit 2 = sin pruebas, nunca aprobado).
//   3. Juicio: `codex exec` en sandbox read-only (un revisor que no puede editar),
//      con tope de vueltas de juez por día.
//   4. Escribe ~/.local/state/auditor/latest.json y el histórico en history.jsonl.
//
// Uso:
//   node auditor-loop.mjs                 # bucle (intervalo de la config)
//   node auditor-loop.mjs --once          # una vuelta y sale
//   node auditor-loop.mjs --once --force  # audita aunque no haya cambios
//   node auditor-loop.mjs --project <nombre>   # solo ese proyecto
//   node auditor-loop.mjs --no-judge      # solo verify.mjs (sin gasto de IA)
// Config: auditor.config.json junto a este archivo, o --config <ruta>.
// Variables: SUPREME_HOME (def. ~/.agents/skills/supreme), AUDITOR_JUDGE_MODEL (opcional),
// AUDITOR_NODE_BIN (carpeta con un Node >= 20, opcional), AUDITOR_STATE_DIR.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const configPath = opt("--config") ?? path.join(HERE, "auditor.config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const STATE_DIR =
  process.env.AUDITOR_STATE_DIR ??
  path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "auditor");
const SUPREME_HOME = process.env.SUPREME_HOME ?? path.join(os.homedir(), ".agents", "skills", "supreme");
const VERIFY = path.join(SUPREME_HOME, "bin", "verify.mjs");

const intervalMin = config.intervalMin ?? 30;
const maxJudgeRunsPerDay = config.maxJudgeRunsPerDay ?? 12;
const verifyTimeoutMs = (config.verifyTimeoutMin ?? 20) * 60_000;
const judgeTimeoutMs = (config.judgeTimeoutMin ?? 15) * 60_000;

fs.mkdirSync(STATE_DIR, { recursive: true });
const latestPath = path.join(STATE_DIR, "latest.json");
const historyPath = path.join(STATE_DIR, "history.jsonl");
const usagePath = path.join(STATE_DIR, "usage.json");

const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
};
const writeJson = (p, v) => {
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};
const log = (...m) => console.log(new Date().toISOString(), ...m);

const env = process.env.AUDITOR_NODE_BIN
  ? { ...process.env, PATH: `${process.env.AUDITOR_NODE_BIN}:${process.env.PATH}` }
  : { ...process.env };

function run(cmd, argv, cwd, timeout) {
  const r = spawnSync(cmd, argv, { cwd, env, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
  return {
    code: r.status ?? (r.error ? -1 : -2),
    out: (r.stdout ?? "") + (r.stderr ?? ""),
    error: r.error?.message,
    timedOut: r.error?.code === "ETIMEDOUT",
  };
}

// Huella: en un repo git, HEAD + cambios sin confirmar; si no, mtimes y
// tamaños de los archivos (sin carpetas de dependencias ni de build).
const SKIP = new Set(["node_modules", "target", ".git", "dist", "build", ".next", "__pycache__", ".venv"]);
function fingerprint(dir) {
  const git = run("git", ["-C", dir, "rev-parse", "HEAD"], dir, 10_000);
  if (git.code === 0) {
    const st = run("git", ["-C", dir, "status", "--porcelain=v1", "-uall"], dir, 20_000);
    const diff = run("git", ["-C", dir, "diff", "HEAD"], dir, 20_000);
    return createHash("sha256").update(git.out + st.out + diff.out).digest("hex").slice(0, 16);
  }
  const h = createHash("sha256");
  let n = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (SKIP.has(e.name) || n > 50_000) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const s = fs.statSync(p);
        h.update(`${p}:${s.size}:${s.mtimeMs}\n`);
        n++;
      }
    }
  };
  walk(dir);
  return h.digest("hex").slice(0, 16);
}

function judgeBudgetLeft() {
  const today = new Date().toISOString().slice(0, 10);
  const u = readJson(usagePath, {});
  return { today, used: u[today] ?? 0, ok: (u[today] ?? 0) < maxJudgeRunsPerDay, u };
}
function countJudgeRun({ today, u }) {
  u[today] = (u[today] ?? 0) + 1;
  for (const k of Object.keys(u)) if (k < today.slice(0, 8)) delete u[k];
  writeJson(usagePath, u);
}

const JUDGE_PROMPT = (p, verify) => `Eres el auditor de este proyecto (${p.name}). Solo lectura: no edites nada.
Revisa lo que cambió recientemente: busca bugs reales, pruebas que pasan sin aserciones, código o copy
genérico de relleno y riesgos de seguridad evidentes. Si tienes instaladas skills tipo antislop, aplícalas.
${p.focus ? `Foco pedido por el usuario: ${p.focus}\n` : ""}
Resultado de verify.mjs (exit ${verify.code}):
${verify.out.slice(-4000)}

Cita evidencia \`ruta:línea\` por hallazgo. Ante la duda, FAIL. Responde en español, terso.
TERMINA con una única línea exactamente así (JSON válido, sin bloque de código):
AUDIT_JSON: {"verdict":"PASS|FAIL","summary":"<una frase>","findings":[{"severity":"high|medium|low","where":"ruta:línea","what":"<problema>","fix":"<arreglo>"}]}`;

function parseAudit(text) {
  const line = text.split("\n").reverse().find((l) => l.trim().startsWith("AUDIT_JSON:"));
  if (!line) return null;
  try {
    const j = JSON.parse(line.trim().slice("AUDIT_JSON:".length).trim());
    if (j.verdict !== "PASS" && j.verdict !== "FAIL") return null;
    return j;
  } catch {
    return null;
  }
}

function judge(p, verify) {
  const argv = ["exec", "-s", "read-only", "-C", p.dir, "--skip-git-repo-check"];
  if (process.env.AUDITOR_JUDGE_MODEL) argv.push("-m", process.env.AUDITOR_JUDGE_MODEL);
  argv.push("-c", 'model_reasoning_effort="high"', JUDGE_PROMPT(p, verify));
  const r = run("codex", argv, p.dir, judgeTimeoutMs);
  const audit = parseAudit(r.out);
  const authFailed = /not logged in|login|unauthorized|401/i.test(r.out) && !audit;
  return {
    ran: true,
    engine: "codex/read-only",
    authFailed,
    code: r.code,
    timedOut: r.timedOut,
    verdict: audit?.verdict ?? "FAIL",
    summary:
      audit?.summary ??
      (authFailed
        ? "codex sin sesión: ejecuta `codex login`"
        : r.timedOut
          ? "el juez agotó el tiempo"
          : "el juez no devolvió AUDIT_JSON válido"),
    findings: audit?.findings ?? [],
    raw: r.out.slice(-6000),
  };
}

function auditProject(p, state) {
  const dir = path.resolve(path.dirname(configPath), p.dir.replace(/^~(?=$|\/)/, os.homedir()));
  if (!fs.existsSync(dir)) {
    return { name: p.name, dir, status: "ERROR", summary: `no existe ${dir}`, ts: new Date().toISOString() };
  }
  const fp = fingerprint(dir);
  const prev = state.projects?.[p.name];
  // A round without the judge (--no-judge, daily cap) does not count as a
  // full audit: the next round still judges the same code.
  const wantsJudge = !flag("--no-judge") && p.judge !== false;
  const complete = prev && prev.status !== "ERROR" && (prev.audit?.ran || !wantsJudge);
  if (!flag("--force") && complete && prev.fingerprint === fp) {
    log(`= ${p.name}: sin cambios (${fp})`);
    return { ...prev, checkedAt: new Date().toISOString() };
  }
  log(`> ${p.name}: verificando (${fp})`);
  const v = run("node", [VERIFY, "--dir", dir], dir, verifyTimeoutMs);
  const verify = { code: v.code, pass: v.code === 0, timedOut: v.timedOut, out: v.out.slice(-6000) };

  let audit = { ran: false, verdict: null, summary: "juez desactivado", findings: [] };
  const wantJudge = !flag("--no-judge") && p.judge !== false;
  if (wantJudge) {
    const budget = judgeBudgetLeft();
    if (budget.ok) {
      log(`> ${p.name}: juez (codex), vuelta ${budget.used + 1}/${maxJudgeRunsPerDay} de hoy`);
      audit = judge({ ...p, dir }, verify);
      countJudgeRun(budget);
    } else {
      audit = { ran: false, verdict: null, summary: `tope diario de juez alcanzado (${maxJudgeRunsPerDay})`, findings: [] };
    }
  }
  const status = !verify.pass || audit.verdict === "FAIL" ? "FAIL" : "PASS";
  const summary = !verify.pass
    ? `verify.mjs exit ${verify.code}${verify.code === 2 ? " (sin pruebas)" : ""}${audit.ran ? ` · juez: ${audit.summary}` : ""}`
    : audit.ran
      ? audit.summary
      : "verify.mjs PASS (sin juez)";
  log(`${status === "PASS" ? "✓" : "✗"} ${p.name}: ${status} — ${summary}`);
  return { name: p.name, dir, fingerprint: fp, status, summary, verify, audit, ts: new Date().toISOString() };
}

function round() {
  const state = readJson(latestPath, { projects: {} });
  state.projects ??= {};
  const only = opt("--project");
  for (const p of config.projects) {
    if (only && p.name !== only) continue;
    const result = auditProject(p, state);
    const changed = result.ts !== state.projects[p.name]?.ts;
    state.projects[p.name] = result;
    state.updatedAt = new Date().toISOString();
    writeJson(latestPath, state);
    if (changed) fs.appendFileSync(historyPath, JSON.stringify({ ...result, verify: undefined, audit: { ...result.audit, raw: undefined } }) + "\n");
  }
  const failing = Object.values(state.projects).filter((r) => r.status !== "PASS").length;
  return failing;
}

if (flag("--once")) {
  process.exit(round() > 0 ? 1 : 0);
}
log(`auditor en bucle cada ${intervalMin} min; estado en ${latestPath}`);
for (;;) {
  try {
    round();
  } catch (e) {
    log("error en la vuelta:", e.message);
  }
  await new Promise((r) => setTimeout(r, intervalMin * 60_000));
}
