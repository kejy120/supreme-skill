# supreme-skill

Orquestador de encargos para **Codex CLI**: enruta cada tarea a las skills que aplican (con presupuesto de tokens)
y **bloquea la entrega con verificación medida**, no con checklists declarativos.

- **`supreme`** (skill): plan primero, enrutado con coste, verificación real de código (lint, typecheck, tests, build) y de webs (17 puertas de scroll/rendimiento en Chromium real + rúbrica de diseño).
- **Agentes** de Codex (`scout`, `builder`, `judge`, `worker`) con esfuerzo y sandbox por tarea.
- **Auditor en bucle**: vigila proyectos, corre `verify` cuando cambian y pide a Codex (solo lectura) un juicio.
- **`AGENTS.md`** con las reglas (plan primero, verificar ejecutando, delegar por tipo de tarea).

Escrito en español. No incluye skills de terceros (ver [THIRD-PARTY.md](THIRD-PARTY.md)).

## Requisitos

| Qué | Versión | Cómo conseguirlo |
|---|---|---|
| Codex CLI | reciente (probado con 0.155) | `npm i -g @openai/codex` o ver la documentación oficial de Codex; luego `codex login` |
| Node.js | ≥ 20 (recomendado 22 LTS) | [nvm](https://github.com/nvm-sh/nvm): `nvm install 22` · o [fnm](https://github.com/Schniz/fnm) · o tu gestor de paquetes |
| git | cualquiera | `sudo dnf/apt install git` |
| Chromium de Playwright | lo descarga el instalador (~150 MB) | solo hace falta para las puertas **web** |
| bash, systemd (opcional) | | systemd solo para el auditor periódico |

En Linux, Chromium puede pedir librerías del sistema: `npx playwright install-deps chromium` (necesita sudo).

## Instalar

```bash
git clone https://github.com/kejy120/supreme-skill.git
cd supreme-skill
./scripts/install.sh
```

Qué hace (nada se pisa sin copia de seguridad):

1. Copia la skill a `~/.agents/skills/supreme/` (si ya había una, la mueve a `~/.agents/supreme-skill-backups/`).
2. Copia los agentes a `~/.codex/agents/` (los que ya existan se conservan; el nuevo queda como `*.toml.nuevo`).
3. Añade las reglas a `~/.codex/AGENTS.md` dentro de un bloque `<!-- supreme-skill:start/end -->`; tu contenido no se toca y volver a instalar solo reemplaza ese bloque.
4. `npm install` y `npx playwright install chromium` en `~/.agents/skills/supreme/bin`.

Opciones: `--project DIR` (instalar solo en un proyecto: `DIR/.agents/skills`, `DIR/.codex/agents`, `DIR/AGENTS.md`),
`--dry-run` (solo mostrar), `--no-deps`, `--no-browser`.

Reinicia Codex después. Comprobación:

```bash
./scripts/selftest.sh
```

Debe imprimir cinco `OK`: el inventario funciona, `verify` aprueba un proyecto con pruebas reales y **suspende** uno sin
pruebas, rechaza una ruta inexistente, y el auditor da PASS/FAIL donde toca.

## Usar

Dentro de Codex, pide el encargo normal o invoca la skill (`$supreme`). Los drivers también van por shell:

```bash
S=~/.agents/skills/supreme/bin

node $S/skill-audit.mjs "landing con scroll animado"   # qué skills aplican y cuánto cuestan (conjunto magro)
node $S/verify.mjs --dir ./mi-proyecto                  # lint + typecheck + tests + build del propio proyecto
node $S/run.mjs "mi encargo" --dir ./mi-sitio           # web: puertas de scroll + rúbrica de diseño
node $S/loop.mjs --dir ./mi-sitio --max 8               # medir → arreglar → medir hasta que pase
```

Códigos de salida de `verify.mjs`: `0` pasa (hubo pruebas ejecutadas), `1` falla, `2` **no verificado** (sin pruebas reales,
stack no reconocido o herramienta ausente). Un `2` nunca cuenta como aprobado.

Contrato completo, fronteras duras y suite adversarial: [`skills/supreme/SKILL.md`](skills/supreme/SKILL.md).

### Agentes y modelos

`scout` (leer, solo lectura, esfuerzo bajo) · `builder` (implementar) · `judge` (juzgar, solo lectura, esfuerzo alto) · `worker` (hereda la sesión).
Para fijar un modelo, añade `model = "..."` al TOML del agente. Desde scripts: `scripts/codex-worker.sh <scout|builder|judge> "<encargo>" [dir]`
(modelos opcionales con `CODEX_SCOUT_MODEL`, `CODEX_BUILDER_MODEL`, `CODEX_JUDGE_MODEL`). Detalle en [docs/routing-modelos.md](docs/routing-modelos.md).

### Auditor en bucle (opcional)

```bash
cp auditor/auditor.config.example.json auditor/auditor.config.json   # edita tus proyectos
node auditor/auditor-loop.mjs --once --no-judge                      # solo verify, sin gasto de IA
node auditor/auditor-loop.mjs --once                                 # con juez Codex de solo lectura
```

Estado en `~/.local/state/auditor/latest.json`. Para que corra cada 30 min con systemd de usuario:

```bash
mkdir -p ~/.config/systemd/user
sed -e "s|@REPO@|$PWD|g" -e "s|@NODEBIN@|$(dirname "$(command -v node)")|g" auditor/systemd/auditor.service > ~/.config/systemd/user/auditor.service
cp auditor/systemd/auditor.timer ~/.config/systemd/user/auditor.timer
systemctl --user daemon-reload && systemctl --user enable --now auditor.timer
```

### Módulo opcional Canva + Higgsfield

`run.mjs --preflight` exige haber usado antes los conectores MCP de Canva y Higgsfield (registro validado en `.supreme/brief.json`).
Es opcional y está **desactivado por defecto**; sin esos conectores ignóralo. Ver `skills/supreme/references/web.md`.

## Estructura

```
skills/supreme/      la skill: SKILL.md, bin/ (drivers Node), references/, templates/
agents/              agentes de Codex (TOML)
AGENTS.md            reglas que el instalador añade a tu AGENTS.md
scripts/             install.sh, selftest.sh, codex-worker.sh
auditor/             auditor en bucle + fixtures de prueba + plantillas systemd
docs/                enrutado de tareas
```

## Qué está verificado y qué no

- Verificado al preparar este repo: el instalador (global, idempotente, sin pisar un `AGENTS.md` existente), `selftest.sh`,
  los drivers `skill-audit`/`verify`/`run` y que Codex 0.155 descubre la skill desde `.agents/skills/` de un proyecto.
- Las puertas web miden de verdad y pueden fallar por carga de la máquina (p. ej. `boot` con long tasks > 200 ms): el driver repite una vez antes de bloquear.
- **No verificado**: que Codex aplique `sandbox_mode` en los TOML de agentes tal cual; el juez real del auditor (`codex exec`) de extremo a extremo; el módulo Canva+Higgsfield (necesita esos conectores).
- La cobertura de `skill-audit` es léxica; en dominio "proceso" la calidad del texto no se mide.

## Licencia

MIT. Las skills de terceros que instales siguen sus propias licencias.
