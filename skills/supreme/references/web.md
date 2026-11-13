# Web: flujo, puertas y gotchas

Solo para encargos que producen una página. PATH, parada del servidor y regla del plan: ver `SKILL.md`.

## Flujo

### 0. Identidad y visual — módulo OPCIONAL (Canva + Higgsfield)

Solo si tienes esos dos conectores MCP configurados en Codex y corres `run.mjs --preflight`. Sin ellos, salta al paso 3 usando el brief o el brand kit que te dé el usuario.

**Regla del módulo para una plantilla de sitio web.** En este orden, porque el paso 3 depende del 1:

1. `Canva:list-brand-kits` → identidad real del cliente. Si hay kit, sus colores y tipografías **mandan** sobre cualquier design system.
2. `Canva:search-brand-templates` → plantilla de partida, si existe. `Canva:export-design` para las referencias que se acuerden.
3. `higgsfield:generate_image_batch` → 6-8 variantes de concepto visual, **con la paleta y tipografía del paso 1 metidas en el prompt**. Bajo [`criterio-anti-look-ia.md`](criterio-anti-look-ia.md), mínimo 18/24.

Luego se pegan las **respuestas verbatim** de ambas APIs y se validan con `preflight.mjs`:

```bash
node ~/.agents/skills/supreme/bin/preflight.mjs --schema        # qué pegar y de dónde sale
node ~/.agents/skills/supreme/bin/preflight.mjs --dir ./sitio --init
node ~/.agents/skills/supreme/bin/preflight.mjs --dir ./sitio   # exit 1 si algo no cuadra
```

Resumen de lo que valida (detalle completo: `--schema`):
- el `brandKitId` existe en los `items[]` de `Canva:list-brand-kits`;
- cada generación de Higgsfield: UUID válido, `status == "completed"`, `rawUrl` coherente con su id, `createdAt` anterior al HTML;
- **`params.colors` solapa con la paleta de identidad**: "juntos" se calcula de lo registrado, no se declara. Sin solape, bloquea aunque el JSON diga que sí.

`run.mjs --preflight` lo ejecuta y para si falla. Sin `--preflight` no se comprueba.
**Límite honesto:** el script no puede llamar a los conectores MCP; el agente pega los registros y el script los valida. No impide fabricar un JSON a mano, sí el atajo de saltarse el paso.

Datos del plan solo-web: dirección de diseño, mapa de secciones, intensidad de movimiento 1-10.
Busca el brief real antes de imaginarlo (en Notion, Drive o Canva si tienes esos conectores; si no, pídelo).

### 3. Construir

Stack y reglas de combinación en [`librerias.md`](librerias.md). **Lenis no existe en cdnjs**: jsDelivr.

Animación (reglas 4 y 5 de las fronteras):
- Solo `transform` y `opacity`; nunca `top`, `left`, `width`, `height`, `margin`, `font-size`.
- Nada de `window.addEventListener('scroll')` para animar. Alternativas: ScrollTrigger, CSS `animation-timeline: scroll()/view()` (scroll-timeline) o IntersectionObserver.

### 4. Medir — no se delega a ningún modelo

```bash
cd <tu-proyecto> && python3 -m http.server 8731 &   # guarda $!
node ~/.agents/skills/supreme/bin/scroll-qa.mjs http://localhost:8731 --out ./qa-out --shots 5 --mobile
node ~/.agents/skills/supreme/bin/rubric.mjs  http://localhost:8731
```

`scroll-qa.mjs`: 17 puertas con `--mobile`, 9 sin. Mide fps en scroll real, long tasks (carga vs scroll), CLS de carga, propiedades animadas (WAAPI + CSSOM + registro interno de GSAP), listeners no-passive atribuidos a su script, y si `prefers-reduced-motion` reduce de verdad. Capturas en `--out`. `--no-gates` sale 2 y no vale para entregar.

`rubric.mjs`: 8 criterios medibles sobre 16 (escala tipográfica, pesos, familias, espaciado, paleta, radios, contraste AA, longitud de línea). Umbral 12/16 (exit 1 por debajo; exit 2 si no es puntuable).

### 5. Mirar las capturas (`judge`)

Abre los PNG (`judge` tiene `Read`). Puntúa lo que los scripts no cubren: jerarquía, ritmo, tono, si el movimiento está motivado. Un informe verde con capturas en blanco es un fallo.

### 6. Imágenes

Todo lo generado pasa por [`criterio-anti-look-ia.md`](criterio-anti-look-ia.md). Mínimo 18/24, cero banderas rojas.

## Plantilla y fixture

- `templates/scroll-landing.html` — landing con sticky-stack pinneado, pan horizontal y reveal. **Verificada: 17/17 puertas (con `--mobile`) y 15/16 rúbrica.** Punto de partida, no resultado.
- `fixtures/antipatrones.html` — página deliberadamente mala, para comprobar que las puertas muerden:
  ```bash
  node ~/.agents/skills/supreme/bin/scroll-qa.mjs http://localhost:8731/antipatrones.html
  # debe salir 1 y bloquear: boot, compositor, scroll-listener, reduced-motion
  ```
  Si pasa en verde, el harness está roto: arréglalo antes de confiar en cualquier informe.

## Design systems a nivel de proyecto

Los de typeui **no son globales**: viven en `~/.agents/design-systems/` (o en `DS_STORE`) para no pagar ~2.500 tokens cada uno en toda sesión. `skill-audit.mjs` escanea global + proyecto (este solo si el cwd está dentro) y los marca con `*`.

```bash
node ~/.agents/skills/supreme/bin/ds.mjs --grep glass      # buscar
node ~/.agents/skills/supreme/bin/ds.mjs bento --into ./mi-web
```


## Gotchas

- **Node 18 no sirve.** Playwright 1.63 exige ≥20; usa Node 22 LTS (nvm, fnm o el gestor que prefieras).
- **Los drivers resuelven `playwright` desde `bin/node_modules`** (ESM resuelve relativo al importador). Un script tuyo fuera de `bin/` no lo encuentra.
- **El scroll programático no marca `hadRecentInput`**: los pin-spacer de ScrollTrigger contarían como CLS. `scroll-qa.mjs` congela el contador antes de conducir; si lo cambias, mide CLS falsos de 0,6.
- **GSAP no usa la Web Animations API.** `document.getAnimations()` da 0 con 9 tweens vivos; hay que leer `gsap.globalTimeline`.
- **Lenis registra a propósito un listener de scroll no-passive.** Culpar a la página es falso positivo; el driver atribuye cada listener a su script.
- **La rúbrica premiaba el vacío**: una página rota con 1 bloque sacaba 14/16. De ahí la guarda de densidad.
- **`clamp()` para espaciado fluido penaliza la escala de espaciado** (muchos valores computados). Es un 1/2 asumido.

## Troubleshooting

- **`Cannot find package 'playwright'`** → script fuera de `bin/`: muévelo o importa por ruta absoluta.
- **`ReferenceError: Lenis is not defined`** → cargado de cdnjs. jsDelivr: `https://cdn.jsdelivr.net/npm/lenis@1.1.18/dist/lenis.min.js`.
- **`scroll-qa` falla `hay-movimiento` con lo demás en verde** → un `<script>` murió al cargar; mira la puerta `console`.
- **`EADDRINUSE`** → para tu servidor con su PID (ver `SKILL.md`). Si el puerto es ajeno, `run.mjs` sale 2: usa `--port`.
- **`rubric.mjs` sale 2** → no es aprobado ni suspenso: poco contenido. Mide la página real, no el esqueleto.
