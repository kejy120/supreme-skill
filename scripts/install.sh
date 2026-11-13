#!/usr/bin/env bash
# Instala supreme-codex para Codex CLI.
#   ./scripts/install.sh                 global: ~/.agents/skills, ~/.codex/agents, ~/.codex/AGENTS.md
#   ./scripts/install.sh --project DIR   solo en un proyecto: DIR/.agents/skills, DIR/.codex/agents, DIR/AGENTS.md
# Opciones: --dry-run (solo muestra), --no-deps (no npm install), --no-browser (no descarga Chromium)
# No pisa nada sin copia de seguridad (carpeta supreme-codex-backups junto a skills).
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT=""; DRY=0; DEPS=1; BROWSER=1
while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:?falta DIR}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --no-deps) DEPS=0; shift ;;
    --no-browser) BROWSER=0; shift ;;
    -h|--help) sed -n 2,6p "$0"; exit 0 ;;
    *) echo "opción desconocida: $1" >&2; exit 64 ;;
  esac
done
if [ -n "$PROJECT" ]; then
  PROJECT="$(cd "$PROJECT" && pwd)"
  SKILLS="$PROJECT/.agents/skills"; AGENTS_DIR="$PROJECT/.codex/agents"; RULES="$PROJECT/AGENTS.md"
else
  SKILLS="$HOME/.agents/skills"; AGENTS_DIR="$HOME/.codex/agents"; RULES="$HOME/.codex/AGENTS.md"
fi
STAMP="$(date +%Y%m%d-%H%M%S)"
do_() { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }
say() { echo "• $*"; }

# 1. Requisitos
command -v node >/dev/null || { echo "Falta Node.js >= 20 (ver README)." >&2; exit 2; }
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 20 ] || { echo "Node $(node -v) es demasiado viejo; hace falta >= 20 (ideal 22)." >&2; exit 2; }
command -v codex >/dev/null || echo "AVISO: no encuentro 'codex' en el PATH (instálalo antes de usar esto)."

# 2. Skill
do_ mkdir -p "$SKILLS"
if [ -e "$SKILLS/supreme" ]; then
  # La copia va FUERA de la carpeta de skills: si no, Codex la descubriría como segunda skill "supreme".
  BK="$(dirname "$SKILLS")/supreme-codex-backups"; do_ mkdir -p "$BK"
  say "copia de seguridad: $SKILLS/supreme -> $BK/supreme.bak-$STAMP"; do_ mv "$SKILLS/supreme" "$BK/supreme.bak-$STAMP"
fi
do_ cp -r "$REPO/skills/supreme" "$SKILLS/supreme"
say "skill instalada en $SKILLS/supreme"

# 3. Agentes (no pisa los que ya existen)
do_ mkdir -p "$AGENTS_DIR"
for f in "$REPO"/agents/*.toml; do
  b="$(basename "$f")"
  if [ -e "$AGENTS_DIR/$b" ]; then say "agente $b ya existe: conservado (el nuevo queda en $AGENTS_DIR/$b.nuevo)"; do_ cp "$f" "$AGENTS_DIR/$b.nuevo"
  else do_ cp "$f" "$AGENTS_DIR/$b"; say "agente $b instalado"; fi
done

# 4. Reglas: bloque delimitado, se reemplaza solo el nuestro
START="<!-- supreme-codex:start -->"; END="<!-- supreme-codex:end -->"
BLOCK="$START
$(cat "$REPO/AGENTS.md")
$END"
if [ "$DRY" = 1 ]; then echo "[dry-run] insertar bloque de reglas en $RULES"
else
  mkdir -p "$(dirname "$RULES")"; touch "$RULES"
  if grep -qF "$START" "$RULES"; then
    cp "$RULES" "$RULES.bak-$STAMP"
    awk -v s="$START" -v e="$END" 'index($0,s){skip=1} !skip{print} index($0,e){skip=0}' "$RULES" > "$RULES.tmp"
    mv "$RULES.tmp" "$RULES"
  fi
  printf '\n%s\n' "$BLOCK" >> "$RULES"
fi
say "reglas añadidas a $RULES (bloque supreme-codex; tu contenido no se toca)"

# 5. Dependencias de los drivers web (Playwright)
if [ "$DEPS" = 1 ]; then
  say "npm install en $SKILLS/supreme/bin"
  if [ "$DRY" = 0 ]; then (cd "$SKILLS/supreme/bin" && npm install --no-audit --no-fund); fi
  if [ "$BROWSER" = 1 ]; then
    say "descargando Chromium para Playwright (~150 MB)"
    if [ "$DRY" = 0 ]; then (cd "$SKILLS/supreme/bin" && npx playwright install chromium); fi
  fi
fi
echo "Listo. Reinicia Codex para que cargue la skill. Comprueba con: ./scripts/selftest.sh"
