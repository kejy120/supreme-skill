# Librerías de diseño, animación y scroll

Versiones consultadas en el registro de npm el 2026-09-14 (última comprobación; no re-verificadas desde entonces), no copiadas de un tutorial. La plantilla está **fijada y verificada en GSAP 3.12.5**; 3.15.0 es la última conocida, no verificada en la plantilla.
Vuelve a comprobarlas con `curl -s https://registry.npmjs.org/<paquete>/latest` antes de fijar una.

| Librería | Última | Peso | Para qué | Cuándo NO |
|---|---|---|---|---|
| **gsap** | 3.15.0 | ~23 KB core | Timelines, secuenciación, easing custom, scrub, pin. El estándar para scroll cinematográfico. | Si solo necesitas un fade al entrar en viewport: sobra. Usa CSS o IntersectionObserver. |
| **lenis** | 1.3.26 | ~3 KB | Smooth scroll con inercia. Estándar de facto 2026. Se sincroniza con ScrollTrigger. | Sitios de lectura larga, dashboards, cualquier cosa donde el usuario busca información rápido. La inercia estorba. |
| **motion** | 13.3.0 | ~18 KB | Animación declarativa en React, `whileInView`, gestos, layout animations. | Timelines largas que hay que pausar, invertir o hacer scrub. Ahí GSAP gana. |
| **three** | 0.186.0 | ~600 KB | WebGL, escenas 3D. | Cualquier cosa que no sea 3D de verdad. 600 KB por un efecto de partículas es indefendible. |
| **@react-three/fiber** | 9.7.0 | + three | Three.js declarativo en React. | Página estática de una sola escena: usa Three.js a pelo. |
| **split-type** | 0.3.4 | ~2 KB | Partir texto en líneas/palabras/caracteres para animarlo. Alternativa libre a SplitText de GSAP. | — |

**CSS scroll-driven animations** (`animation-timeline: scroll()` / `view()`) no es una librería: es plataforma.
Cubre reveal al entrar en viewport, barras de progreso y parallax simple con **cero JavaScript**.
Úsalo primero y baja a GSAP solo cuando necesites secuenciación o pin. Comprueba el soporte real en
[MDN browser-compat-data](https://github.com/mdn/browser-compat-data/blob/main/css/properties/animation-timeline.json)
antes de prometer cobertura — no lo des por hecho.

---

## Assets de stock (no son librerías de código)

| Fuente | Qué | Licencia |
|---|---|---|
| **Envato Elements** — [video-templates](https://elements.envato.com/es/video-templates) | Plantillas de video (After Effects/Premiere), motion graphics, stock footage | Suscripción; revisar licencia por proyecto antes de entregar al cliente |

Usar solo cuando el cliente no tiene metraje propio y Higgsfield/magnific no cubren el formato
(video editado, no generado). No sustituye el paso Canva+Higgsfield en `preflight.mjs` para imagen.

---

## Reglas duras de combinación

Estas no son preferencias. Vienen de las skills ya instaladas (`design-taste-frontend`, `gsap-performance`) y se sostienen solas:

- **Nunca mezcles GSAP/Three.js con Motion en el mismo árbol de componentes.** Dos motores de rAF peleando por los mismos nodos producen jank que no se depura.
- **Nunca `window.addEventListener('scroll', ...)`** para animar. Usa ScrollTrigger, IntersectionObserver o scroll-driven CSS. El harness `scroll-qa.mjs` lo detecta y bloquea la entrega.
- **Solo `transform` y `opacity`.** Animar `top`, `left`, `width`, `height`, `margin` o `font-size` fuerza relayout en cada frame. `scroll-qa.mjs` también bloquea esto.
- **Lenis alimenta a ScrollTrigger, no al revés.** El patrón correcto:
  ```js
  const lenis = new Lenis({ duration: 1.05 });
  lenis.on('scroll', () => ScrollTrigger.update());
  gsap.ticker.add(t => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  ```
- **Limpia siempre.** `gsap.context()` en React/Vue, o los ScrollTrigger sobreviven al desmontaje y disparan sobre nodos muertos.

---

## Gotchas de CDN verificados aquí

Descubiertos ejecutando, no leyendo documentación:

- **Lenis NO está en cdnjs.** `https://cdnjs.cloudflare.com/ajax/libs/lenis/...` devuelve **404** para cualquier ruta y versión. La API de cdnjs responde `"Library not found"`. Usa jsDelivr:
  ```html
  <script src="https://cdn.jsdelivr.net/npm/lenis@1.1.18/dist/lenis.min.js"></script>
  ```
  El bundle hace `globalThis.Lenis = L`, así que el global es `Lenis`.
- Si una librería falla al cargar, **el script entero muere y no se anima nada** — pero las métricas de rendimiento salen perfectas, porque no hay nada que renderizar. Un informe con 60 fps, CLS 0 y **cero animaciones vivas** no es una página rápida: es una página rota. Por eso `scroll-qa.mjs` tiene la puerta `hay-movimiento`.
- GSAP sí está en cdnjs; en la consulta del 2026-09-14 la última coincidía con npm (3.15.0), sin probar en la plantilla.

---

## Combinación verificada funcionando en este contenedor

GSAP 3.12.5 + ScrollTrigger 3.12.5 (cdnjs) + Lenis 1.1.18 (jsDelivr), con sticky-stack pinneado,
pan horizontal gobernado por scroll vertical y reveal por viewport.
Resultado medido: **60 fps mediano, 0 long tasks durante scroll, CLS 0, solo transform/opacity,
17/17 puertas superadas** en 1440x900 y 390x844.
