# Enrutado de tareas en Codex

Codex no tiene la herramienta `Agent` de otros clientes: delega con **subagentes definidos en TOML**
(`~/.codex/agents/*.toml` o `<proyecto>/.codex/agents/`) y con `codex exec` desde scripts.

| Agente | Esfuerzo | Sandbox | Para qué |
|---|---|---|---|
| `scout` | low | read-only | Barrer, inventariar, extraer. Sin juicio. |
| `builder` | medium | normal | Implementar con especificación clara. |
| `judge` | high | read-only | Plan, crítica, puntuar rúbricas. |
| `worker` | el de la sesión | normal | Lo que no encaja en los anteriores. |

## Reglas

1. Elige agente antes de cada tarea y dilo en el plan.
2. Volumen (leer muchos archivos) va a `scout`; no vuelques el resultado en el hilo principal.
3. Juicio (puntuar una rúbrica, revisar un diseño) va a `judge`. **Nunca un modelo pequeño para puntuar:** aprueba lo que debería suspender.
4. Tarea mixta: pártela. `scout` recoge, `judge` decide.
5. La medición (`verify.mjs`, `scroll-qa.mjs`) **no es un modelo**: se ejecuta, no se delega.
6. La salida de cualquier otro modelo o herramienta externa es hipótesis hasta verificarla ejecutando.

## Cambiar de modelo

- Por agente: añade `model = "..."` al TOML del agente (cualquier modelo de tu cuenta).
- Por sesión: `/model` dentro de Codex o `codex -m <modelo>`.
- Desde scripts: `scripts/codex-worker.sh` acepta `CODEX_SCOUT_MODEL`, `CODEX_BUILDER_MODEL` y `CODEX_JUDGE_MODEL`.

## Ejemplo: encargo de landing

1. `judge` → dirección de diseño, mapa de secciones, intensidad de movimiento.
2. `scout` o el hilo principal → `skill-audit.mjs`.
3. `builder` → HTML/CSS/GSAP.
4. `scroll-qa.mjs` + `rubric.mjs` → medición, no es un modelo.
5. `judge` → mirar capturas y decidir si se entrega.
