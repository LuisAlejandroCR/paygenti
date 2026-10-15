<!-- docs/design.md: el sistema de diseño de paygent tal como está hoy ("Cempasúchil") — tokens claro/oscuro,
     dónde vive cada copia (web, dashboard, móvil), fuentes, reglas de color, tamaños táctiles, movimiento y
     texto grande. No es la guía de accesibilidad (docs/accessibility.md) ni la bitácora (docs/memoria.md);
     si un valor cambia aquí, cambia en las tres copias de código. -->

# Diseño — "Cempasúchil"

Estado al 2026-10-14. Origen: PR #17 (diseño vino portado a vendedora, bocina y back office) y PR #40
(dashboard). Este documento describe el código, no una propuesta.

**Paleta "Cempasúchil" desde 2026-10-14** (reemplaza a "Merlot Dream"; comparativa con las otras
alternativas en la memoria del mismo día). Mismos roles que antes; cambian tres cosas: el vino de acción es
más profundo y se separa del rojo destructivo, PAGADO/verificado pasa de verde a añil (se distingue del vino
con daltonismo rojo-verde) y el azul PayPal es el de marca (`#0070BA`), dentro de sRGB.

## Dónde viven los tokens (tres copias)

| Superficie | Archivo | Cómo se aplica claro / oscuro |
|---|---|---|
| App web (`web/`) | `web/src/styles.css` | `:root` claro; `@media (prefers-color-scheme: dark)` oscuro (sigue al sistema, sin interruptor); `:root[data-contrast="high"]` alto contraste |
| Dashboard (`paygent-dashboard/`) | `paygent-dashboard/src/styles.css` | `:root` claro; clase `.dark` en `<html>` desde Preferencias (por defecto claro, guardado en `localStorage`); Tailwind v4 los expone con `@theme inline` |
| App móvil (`mobile/`) | `mobile/src/lib/theme.ts` | `LIGHT` / `DARK` en hex sRGB (aproximación de los oklch de la web); `useColorScheme()` sigue al sistema |

No hay generador: **las tres copias se mantienen sincronizadas a mano**. Además, el fondo del ícono
adaptativo de Android (`#7D1439` en `mobile/app.config.ts`) es el vino claro del móvil.

## Tokens

Valores de `web/src/styles.css` y `paygent-dashboard/src/styles.css` (oklch) y de `mobile/src/lib/theme.ts` (hex).
"—" = el token no existe en esa copia.

| Rol | Web | Dashboard | Móvil | Claro (oklch) | Oscuro (oklch) | Móvil claro / oscuro |
|---|---|---|---|---|---|---|
| Fondo | `--background` | `--background` | `background` | `0.95 0.025 85` | `0.21 0.03 25` | `#F6EEDC` / `#251311` |
| Texto | `--foreground` | `--foreground` | `foreground` | `0.27 0.03 30` | `0.94 0.025 75` | `#34211E` / `#F5E9D9` |
| Superficie / tarjeta | `--surface`, `--card` | `--card`, `--popover` | `surface` | `0.985 0.012 85` | `0.26 0.032 25` | `#FEFAF1` / `#321E1C` |
| Apagado | `--muted` | `--muted` | `muted` | `0.9 0.045 80` | `0.3 0.035 30` | `#EEDBBD` / `#3E2723` |
| Texto apagado | `--muted-foreground` | `--muted-foreground` | `mutedForeground` | `0.46 0.04 50` | `0.78 0.04 60` | `#6B5244` / `#CBB29E` |
| Borde | `--border` | `--border` (`--input`: `0.83 0.04 75` / `0.42 0.04 30`) | `border` | `0.85 0.04 75` | `0.4 0.04 30` | `#DECBB1` / `#5B403B` |
| Vino: acción | `--action` | `--primary` (oscuro: `0.69 0.095 12`, rosa) | `action` | `0.39 0.14 6` | `0.54 0.17 6` | `#7D1439` / `#BA365F` |
| Texto sobre vino | `--action-foreground` | `--primary-foreground` | `actionForeground` | `0.985 0.006 90` | `0.985 0.006 90` | `#FCFAF6` / `#FCFAF6` |
| Vino como texto (enlaces) | `--action-text` | `--primary-text` | `actionText` | `0.39 0.14 6` | `0.8 0.1 10` | `#7D1439` / `#F6A3AF` |
| Azul PayPal | `--paypal` | — (solo como serie `--chart-4`) | `paypal` | `0.532 0.143 248` | `0.72 0.13 252` | `#0170BA` / `#64A9F3` |
| Texto sobre azul | `--paypal-foreground` | — | `paypalForeground` | `1 0 0` | `0.17 0.03 254` | `#FFFFFF` / `#06101C` |
| Éxito / PAGADO (añil) | `--success` | `--success` (`--success-soft`) | `success` | `0.51 0.09 185` | `0.78 0.1 190` | `#00766D` / `#60CCC5` |
| Verificado (PayPal) | — | `--verified` | — (usa `action`) | `0.51 0.09 185` | `0.78 0.1 190` | — |
| Autodeclarado | — | `--declared` | — (usa `mutedForeground` al 45 %) | `0.42 0.13 300` | `0.68 0.14 315` | — |
| Destructivo | `--destructive` | `--destructive` (`--danger-soft`) | `destructive` | `0.54 0.2 29` | `0.7 0.17 30` | `#C9241B` / `#F66E5C` |
| Aviso | `--warning` | `--warning` (`--warning-soft`, `--warning-foreground`) | `warning` | `web 0.53 0.12 62, dashboard 0.78 0.16 70` | `web 0.82 0.15 75, dashboard 0.8 0.15 75` | `#9C5906` / `#FCB442` |
| Anillo de foco | `--ring` | `--ring` | — | `0.39 0.14 6` | `0.76 0.12 8` | — |

Solo en el dashboard: `--secondary`, `--accent`, la familia `--sidebar-*`, sombras `--shadow-soft-v` /
`--shadow-lift-v` y siete series de gráfica `--chart-1` … `--chart-7` (vino, añil, tinto,
azul PayPal, verde, magenta, ámbar).

Solo en la web: alto contraste (`data-contrast="high"`): fondo negro, texto blanco, acción, foco y PayPal en
amarillo `#ffeb3b`, éxito `#00e676`, destructivo `#ff8a80`, todo control con borde de 2 px y enlaces subrayados.

Radio: web `--radius: 1rem` (16 px), dashboard `--radius: 0.75rem` (12 px) con escalas `--radius-sm` …
`--radius-3xl`, móvil `RADIUS = 16`.

### Diferencias conocidas entre copias

- `--primary` **no significa lo mismo**: en la web es el tinto oscuro del texto (`0.28 0.03 20`); en el
  dashboard es el vino de acción (convención shadcn). Al copiar estilos entre los dos, traducir el nombre.
- `--warning` tiene valores distintos en web y dashboard.
- Verificado / autodeclarado como tokens propios solo existen en el dashboard. La web no los tiene; en
  el móvil (tira de días de Resumen) lo verificado va en vino (`action`) y lo autodeclarado en
  `mutedForeground` al 45 % de opacidad, sin morado ni trama.
- Modo oscuro: la web y el móvil siguen al sistema; el dashboard usa su propio interruptor.

## Fuentes

- **Bricolage Grotesque** (titulares y cifras, `font-variant-numeric: tabular-nums`) e **Inter** (texto).
- Web: Google Fonts en `web/index.html` (Bricolage 500/700/800, Inter 400/500/600); variables
  `--font-display` y `--font-sans`.
- Dashboard: Google Fonts en `paygent-dashboard/src/routes/__root.tsx` (Inter suma 700). Bricolage está
  mapeada a `--font-mono` y se usa con la utilidad `num` para cifras: el nombre es heredado, no es monoespaciada.
- Móvil: `@expo-google-fonts` cargadas en `mobile/app/_layout.tsx` (`FONTS` en `theme.ts`: Bricolage
  600/700, Inter 400/600); el splash espera a que carguen.

## Reglas de color

1. **Vino = acciones de la vendedora**: Cobrar, micrófono, teclado, botones principales del back office y
   del dashboard.
2. **Azul PayPal solo en UI de pago**: venta abierta esperando pago, checkout del cliente y sus botones.
   En el dashboard solo aparece como serie de gráfica.
3. **Añil = confirmado por el proveedor**: la pantalla PAGADO y lo verificado (captura PayPal).
4. **Morado con trama = autodeclarado**: efectivo, confirmado por la vendedora e importación de estado de
   cuenta. La trama (`hatch`, `hatch-soft`, `hatch-on-wine`: rayas a 45°) hace que no dependa solo del color
   (WCAG 1.4.1). Verificado y autodeclarado se muestran juntos pero **nunca se suman**.
5. **Ámbar = por confirmar** (`pending_bank` en el dashboard): nunca verde, nunca cuenta como pagado.
6. **Rojo destructivo**: reembolsos, rechazos y errores.
7. En alto contraste (web) todo se reduce a negro, blanco y amarillo; el significado lo cargan texto e íconos.

## Tamaños táctiles

- Web: `--touch: 56px` como alto o ancho mínimo de botones, teclas del teclado y pasos del carrito.
- Móvil: `TOUCH = 56` (pt).
- Dashboard: botones de ícono de 44 px (`size-11`) y la mayoría de los botones entre 44 y 56 px
  (`min-h-11`, `min-h-12`, `h-12`, `h-14`); hay controles secundarios más chicos (`min-h-9`, `h-7`,
  `size-6`) sin auditar.
- Web y móvil superan con margen el mínimo AA de WCAG 2.2 (2.5.8, 24 px). En el dashboard falta revisar
  esos controles chicos contra 2.5.8.

## Movimiento reducido

- Web: con `prefers-reduced-motion: reduce` las animaciones y transiciones duran 0.01 ms; la palomita de
  PAGADO se dibuja completa sin trazo animado.
- Dashboard: misma regla, sin escala al presionar (`pressable`) y los números animados saltan al valor final.
- Móvil: `PaidFlood` consulta `AccessibilityInfo.isReduceMotionEnabled()` antes de animar.

## Texto grande

- Web: tamaños en `rem`; el e2e verifica que no haya scroll horizontal con la fuente raíz al 200 %.
- Dashboard: Preferencias → texto grande pone `html.large-text` (`font-size: 118%`).
- Móvil: React Native respeta la escala de fuente del sistema (no se desactiva `allowFontScaling`); ⏳ sin
  probar en dispositivos con texto grande.

## Foco

- Web: anillo de 3 px con `--ring` y un halo del color de fondo, visible sobre cualquier superficie.
- Dashboard: anillo de 2 px con `--ring`.
