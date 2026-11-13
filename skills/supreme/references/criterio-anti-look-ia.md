# Criterio anti-look-IA en imágenes generadas

> Criterio del usuario. Se aplica **íntegro** a toda imagen que entre en una entrega:
> generada con los conectores `magnific` o `higgsfield`, o traída de fuera.

**Principio rector:** una imagen se delata como sintética por **exceso de perfección** y por **ausencia de causa física**. La corrección no es "más calidad" — es introducir las huellas que deja el mundo real: una fuente de luz concreta, una lente con defectos, un sensor con ruido, un fotógrafo con manos imperfectas y un lugar con desorden.

**Cómo se usa:** cada criterio se puntúa **0 / 1 / 2** sobre la imagen final.
`0` = tell presente y evidente · `1` = mitigado parcialmente · `2` = resuelto.
Máximo 24. Por debajo de 18 la imagen se lee como IA para cualquiera que vea imágenes generadas a diario.

---

## Parte 1 — Los 12 criterios

### C1. Luz motivada y única

El delator #1. Los generadores producen iluminación "de estudio en todas partes": sujeto con luz de contra dorada, relleno frontal, sin sombra dura, sin lado oscuro.

- **Corrección:** una fuente dominante, identificable, con dirección declarada. Sombras duras y con dirección coherente. Un lado del sujeto puede y debe quedar subexpuesto. Luz de ventana lateral, una lámpara de techo, un flash directo.
- **Test:** ¿puedo señalar en la imagen de dónde viene la luz, y hay algo en la escena que la justifique?

### C2. Profundidad de campo físicamente posible

El bokeh sintético es cremoso, uniforme y con transición imposible: el sujeto perfectamente nítido y el fondo disuelto sin plano intermedio. O el opuesto: todo nítido de frente a fondo, que solo pasa con f/16 y luz de mediodía.

- **Corrección:** declarar distancia focal y apertura, y respetar sus consecuencias. A f/1.8 una oreja está fuera de foco si el ojo está dentro. El plano de enfoque es un *plano*, no un contorno.
- **Test:** ¿hay algo a media distancia con desenfoque intermedio?

### C3. Firma óptica del lente

El renderizado limpio es sospechoso. Los lentes reales fallan: aberración cromática en bordes de alto contraste, viñeteo en esquinas, caída de nitidez hacia los bordes, distorsión de barril en angular, flare cuando hay luz directa.

- **Corrección:** especificar cámara + lente concretos y añadir estos defectos en postproducción si el generador no los pone.
- **Test:** ¿las esquinas están igual de nítidas y luminosas que el centro? Si sí, no es una foto.

### C4. Grano y textura del sensor

Las salidas de generador son sospechosamente limpias en las sombras. Ninguna cámara lo es.

- **Corrección:** grano monocromático añadido en post, más presente en sombras y medios tonos que en luces. ISO declarado alto para escenas de poca luz, con el ruido que le corresponde.
- **Falla típica:** aplicar grano uniforme sobre toda la imagen, incluidas las altas luces. Se ve como filtro, no como sensor.

### C5. Piel y superficies con historia

Piel de plástico, poros uniformes, cero asimetría facial, dientes de anuncio, pelo con cada mechón en su sitio.

- **Corrección:** pedir asimetría explícita, poros irregulares, brillo desigual, imperfecciones concretas y localizadas (una cicatriz, ojeras, un mechón fuera de sitio, labios secos). Lo mismo para objetos: rayones, polvo, desgaste en los bordes que más se tocan.
- **Test:** ¿los dos lados de la cara son intercambiables por espejo?

### C6. Composición imperfecta

La IA centra, simetriza y equilibra. La fotografía real recorta mal, deja aire donde no debía, tiene el horizonte medio grado torcido y elementos cortados por el marco sin elegancia.

- **Corrección:** sujeto descentrado, recorte que amputa parte del sujeto, un objeto en primer plano que estorba, encuadre desde una altura no ideal.
- **Falla típica:** pedir "composición dinámica", que el generador interpreta como *otra* composición perfecta.

### C7. Coherencia de sombras y reflejos

Segundo delator más fuerte tras la luz. Sombras que no apuntan al mismo lugar, objetos sin sombra de contacto, reflejos en ojos o cristales que no corresponden a nada de la escena, espejos que muestran algo distinto.

- **Corrección:** verificación manual. Trazar mentalmente cada sombra hacia la fuente. Verificar que cada objeto toca el suelo con una sombra de contacto oscura.
- **Test:** ¿todas las sombras convergen? ¿Lo reflejado existe en la escena?

### C8. Zonas de fallo estructural: manos, texto, patrones

Manos y dedos, texto legible, joyería, dientes, rejas, escaleras, patrones repetidos de tela, cadenas, radios de bicicleta, teclados. Ahí es donde se rompe la geometría.

- **Corrección:** contar dedos. Leer todo el texto. Seguir cada patrón repetido para ver si mantiene el paso. Corregir con inpainting dirigido, no regenerando toda la imagen. Si el texto no es esencial, sacarlo del encuadre o desenfocarlo.
- **Regla dura:** ninguna imagen se publica sin esta verificación. Es el tell que reconoce hasta quien no sabe nada de IA.

### C9. Paleta mundana

El look IA por defecto: naranja y teal, saturación alta, hora dorada, cielo dramático, contraste HDR con halos alrededor de los bordes.

- **Corrección:** condiciones de luz aburridas y específicas. Mediodía nublado. Fluorescente de oficina con su verde. Interior de tungsteno con su naranja **sin corregir**. Bajar saturación global. Aplanar el contraste. Permitir que los blancos no sean blancos.
- **Test:** ¿la imagen parece querer venderme algo?

### C10. Desorden y contexto específico

Los fondos generados son limpios o genéricamente detallados. Los espacios reales tienen basura: un cable mal puesto, una taza usada, un enchufe, una etiqueta de precio, papel arrugado, una mancha en la pared.

- **Corrección:** nombrar 3–5 objetos mundanos concretos que van en el fondo. Especificar el lugar con precisión en lugar de por categoría.
- **Falla típica:** pedir "fondo desordenado" → el generador produce desorden decorativo, simétrico y compuesto. Hay que nombrar los objetos.

### C11. Vocabulario del prompt

Ciertas palabras son atajos directos al centro de la distribución "arte IA". Evitar: *masterpiece, 8k, ultra detailed, hyperrealistic, cinematic, ethereal, breathtaking, award winning, trending on artstation, perfect, flawless, intricate, majestic*.

- **Corrección:** sustituir adjetivos de calidad por **especificaciones técnicas y contexto**. No "retrato cinematográfico impresionante" sino "35mm, f/2, luz de ventana lateral a la izquierda, mediodía nublado, interior de cocina, sujeto mirando fuera de cuadro".
- **Regla:** el prompt describe *condiciones de captura*, no *juicios de valor*.

### C12. Pasada de postproducción

Casi ninguna salida directa de generador pasa. La cadena mínima, en orden: recortar (rompe la composición perfecta y elimina bordes sospechosos) → bajar saturación y aplanar contraste → añadir grano ponderado por luminancia → aberración cromática leve en bordes → viñeteo suave → **reducir resolución** y volver a comprimir con JPEG de calidad media.

- El paso final importa más de lo que parece: la nitidez uniforme a resolución nativa es en sí misma un tell, y ninguna imagen que circula por internet real llega sin pérdidas de compresión.
- **Test:** ¿la imagen pasó por al menos cuatro de esos pasos?

---

## Parte 2 — Banderas rojas

Cualquiera presente descarta la imagen sin importar la puntuación:

| # | Bandera |
|---|---|
| 1 | Cuenta de dedos incorrecta o articulación imposible |
| 2 | Texto legible mal escrito o con letras inventadas |
| 3 | Sombras que apuntan a direcciones distintas |
| 4 | Objeto sin sombra de contacto: parece flotar |
| 5 | Simetría facial perfecta |
| 6 | Patrón repetido que pierde el paso a mitad de recorrido |
| 7 | Halo brillante alrededor de siluetas de alto contraste |
| 8 | Reflejo que no corresponde a nada visible en la escena |
| 9 | Sombras completamente limpias, sin ruido |
| 10 | Todo el cuadro con la misma nitidez y el mismo nivel de detalle |
| 11 | Fusión de objetos en las transiciones (pelo con fondo, dedos con tela) |
| 12 | Accesorios asimétricos que deberían ser pares: aretes, mangas, cordones, patillas de lentes |

---

## Parte 3 — Uso operativo

### Plantilla de prompt

En este orden, porque los generadores pesan más lo que viene primero:

1. **Sujeto y acción**, en lenguaje llano
2. **Lugar específico**, nombrado, no categórico
3. **3–5 objetos mundanos** de contexto
4. **Luz:** fuente única + dirección + hora + condición atmosférica
5. **Cámara:** cuerpo, distancia focal, apertura, ISO
6. **Imperfecciones:** dos o tres, concretas y localizadas
7. **Encuadre:** descentrado, altura no ideal, qué se corta
8. **Nada de adjetivos de calidad**

### Flujo de verificación

1. Generar 6–8 variantes en lugar de perseguir una perfecta.
2. Descartar por banderas rojas antes de mirar estética.
3. Inpainting dirigido en manos, texto y patrones de la que sobreviva.
4. Pasada de postproducción completa (C12).
5. Puntuar C1–C12. Por debajo de 18, volver al paso 1 ajustando el prompt — no la postproducción.

### Prueba final

Mirar la imagen tres segundos, cerrar, y preguntar: **¿qué cámara la tomó y quién la sostenía?** Si no hay respuesta plausible, falta C1, C3 o C6.

---

## Nota

Esto es un criterio de **calidad visual y verosimilitud fotográfica** — para trabajo comercial, mockups, referencias y contenido donde el look IA resta credibilidad. No aplica para hacer pasar imágenes sintéticas por documentación de hechos, ni para representar personas reales en situaciones que no ocurrieron. Ahí el problema no es estético, y ninguna cantidad de grano lo arregla.

---

## Cableado a los conectores de esta sesión

| Paso | Herramienta |
|---|---|
| Generar variantes (6–8) | `magnific:images_generate` o `higgsfield:generate_image_batch` |
| Inpainting dirigido en manos/texto | `magnific:images_retouch` |
| Reencuadre que rompe la simetría (C6) | `magnific:images_crop`, `magnific:images_expand` |
| Relighting cuando C1 falla | `magnific:images_relight` |
| Quitar fondo limpio y montarlo sobre uno con desorden real (C10) | `magnific:images_remove_background` |
| Bajar resolución final (C12) | `magnific:images_resize` |

**No** uses `images_upscale` como paso final: sube nitidez uniforme, que es justo la bandera roja nº 10.
