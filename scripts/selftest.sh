#!/usr/bin/env bash
# Pruebas de humo: un caso que pasa y uno que falla. Usa la skill de ESTE repo, no la instalada.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO/skills/supreme/bin"; fail=0
ok()  { echo "  OK   $1"; }
bad() { echo "  FALLA $1"; fail=1; }

out="$(SKILLS_DIR="$REPO/skills" node "$BIN/skill-audit.mjs" 2>&1)"; rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -qi 'skills' && ok "skill-audit inventaría (pasa)" || bad "skill-audit: exit $rc"

node "$BIN/verify.mjs" --dir "$REPO/auditor/fixtures/ok-project" >/dev/null 2>&1; rc=$?
[ $rc -eq 0 ] && ok "verify.mjs sobre ok-project: exit 0 (pasa)" || bad "ok-project debía dar 0, dio $rc"

node "$BIN/verify.mjs" --dir "$REPO/auditor/fixtures/bad-project" >/dev/null 2>&1; rc=$?
[ $rc -ne 0 ] && ok "verify.mjs sobre bad-project: exit $rc (falla, como debe)" || bad "bad-project debía fallar y dio 0"

node "$BIN/verify.mjs" --dir /noexiste >/dev/null 2>&1; rc=$?
[ $rc -ne 0 ] && ok "verify.mjs sobre ruta inexistente: exit $rc" || bad "ruta inexistente no debe pasar"

node "$REPO/auditor/auditor-loop.mjs" --once --force --no-judge --config "$REPO/auditor/fixtures/test.config.json" >/dev/null 2>&1; rc=$?
[ $rc -eq 1 ] && ok "auditor: ok-project PASS y bad-project FAIL (exit 1)" || bad "auditor: se esperaba exit 1, dio $rc"
exit $fail
