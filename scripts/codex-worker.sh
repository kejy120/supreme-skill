#!/usr/bin/env bash
# Lanza Codex como trabajador con esfuerzo adaptativo.
# Uso: codex-worker.sh <scout|builder|judge> "<encargo>" [directorio]
#   scout   barrer/leer, solo lectura            esfuerzo low
#   builder implementar, escribe solo en el dir  esfuerzo medium
#   judge   juicio/rúbricas, solo lectura        esfuerzo high
# Modelo opcional por nivel: CODEX_SCOUT_MODEL, CODEX_BUILDER_MODEL, CODEX_JUDGE_MODEL.
# Sin ellas se usa el modelo por defecto de tu config de Codex.
set -euo pipefail
tier="${1:?tier: scout|builder|judge}"; task="${2:?falta el encargo}"; dir="${3:-$PWD}"
case "$tier" in
  scout)   effort=low;    sandbox=read-only;       model="${CODEX_SCOUT_MODEL:-}" ;;
  builder) effort=medium; sandbox=workspace-write; model="${CODEX_BUILDER_MODEL:-}" ;;
  judge)   effort=high;   sandbox=read-only;       model="${CODEX_JUDGE_MODEL:-}" ;;
  *) echo "tier desconocido: $tier" >&2; exit 64 ;;
esac
prompt="ROL: $tier. Responde terso. Marca como no verificado lo que no ejecutes.

ENCARGO:
$task"
args=(exec -c "model_reasoning_effort=\"$effort\"" -s "$sandbox" -C "$dir" --skip-git-repo-check)
[ -n "$model" ] && args+=(-m "$model")
exec codex "${args[@]}" "$prompt"
