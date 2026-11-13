# Herramientas de scrapeo web — opciones

Para lo que de verdad hace falta en diseño: **traer referencias**. Capturar competidores,
extraer paletas y escalas tipográficas de un sitio que gusta, recolectar copy, vaciar un
sitio antiguo antes de rediseñarlo.

## Tabla de decisión

| Herramienta | Tipo | Cuándo es la correcta | Coste | Cuándo NO |
|---|---|---|---|---|
| **Playwright** | Navegador local | Ya está instalado aquí (`bin/node_modules`). Capturas, DOM, CSS computado, medir. Control total. | Gratis | Rastrear 10.000 URLs. Se te va la tarde. |
| **Crawl4AI** | Librería Python sobre Playwright | Mejor opción gratuita para convertir URL → markdown limpio para un LLM. Extracción por esquema. | Gratis, self-host | Si no quieres mantener infraestructura de navegadores. |
| **Firecrawl** | API alojada | Crawl de sitio entero → markdown, con JS, paginación y anti-bot resueltos. La más cómoda para agentes. | De pago, con free tier | Una sola página: es matar moscas a cañonazos. |
| **Scrapy** | Framework Python | Extracción estructurada a gran escala de sitios estáticos. Pipelines, reintentos, throttling. | Gratis | Sitios que renderizan con JS. No ejecuta scripts. |
| **Búsqueda web nativa de Codex** (`--search`) | Herramienta de Codex | Una URL, una pregunta. Cero setup. | Incluido | Contenido tras login, o si necesitas el HTML crudo. |

## Recomendación por tarea de diseño

- **"Quiero las referencias visuales de estos 5 sitios"** → Playwright, ya instalado. Captura a dos viewports y extrae los tokens de CSS en la misma pasada.
- **"Resume qué hace la competencia"** → la búsqueda web de Codex. No montes nada.
- **"Vacía el sitio viejo, lo vamos a rediseñar"** → Firecrawl si el presupuesto lo permite; Crawl4AI si no.
- **"Necesito 3.000 fichas de producto"** → Scrapy, y solo si el sitio es estático.

## Extracción de tokens de diseño con lo que ya hay

Sin instalar nada más. Saca paleta real, escala tipográfica y espaciado de cualquier sitio:

```bash
cd ~/.agents/skills/supreme/bin
node -e "
import('playwright').then(async ({chromium}) => {
  const b = await chromium.launch({args:['--no-sandbox']});
  const p = await b.newPage({viewport:{width:1440,height:900}});
  await p.goto(process.argv[1], {waitUntil:'load'});
  const t = await p.evaluate(() => {
    const c = new Map(), f = new Map(), s = new Map();
    for (const el of document.querySelectorAll('*')) {
      const g = getComputedStyle(el);
      for (const [m,k] of [[c,'color'],[c,'backgroundColor'],[f,'fontSize'],[f,'fontFamily'],[s,'gap']]) {
        const v = g[k]; if (v && v !== 'rgba(0, 0, 0, 0)' && v !== 'normal') m.set(v,(m.get(v)||0)+1);
      }
    }
    const top = m => [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12);
    return { colores: top(c), tipografia: top(f), espaciado: top(s) };
  });
  console.log(JSON.stringify(t, null, 2));
  await b.close();
});
" https://ejemplo.com
```

## Límites

- Respeta `robots.txt` y los términos del sitio. Extraer referencias visuales para inspirarte es una cosa; clonar un sitio ajeno es otra.
- Contenido tras login: no. Si hace falta, que lo saque el usuario.
- Un sitio que detecta automatización y te bloquea está diciendo que no. No se evade.

