<!-- docs/design.md: el sistema de diseño de paygent tal como está hoy ("Merlot Dream") — tokens claro/oscuro,
     dónde vive cada copia (web, dashboard, móvil), fuentes, reglas de color, tamaños táctiles, movimiento y
     texto grande. No es la guía de accesibilidad (docs/accessibility.md) ni la bitácora (docs/memoria.md);
     si un valor cambia aquí, cambia en las tres copias de código. -->

# Diseño — "Merlot Dream"

Estado al 2026-10-14. Origen: PR #17 (diseño vino portado a vendedora, bocina y back office) y PR #40
(dashboard). Este documento describe el código, no una propuesta.

**Decisión pendiente: paleta alternativa en revisión (2026-10-14).** Hay pasadas de UI/UX en curso en
`feat/web-ux-pass` y `feat/dashboard-ux-pass` (sin mergear). Si la paleta cambia, se actualiza esta página
y las tres copias de tokens en el mismo PR.

## Dónde viven los tokens (tres copias)

| Superficie | Archivo | Cómo se aplica claro / oscuro |
|---|---|---|
| App web (`web/`) | `web/src/styles.css` | `:root` claro; `@media (prefers-color-scheme: dark)` oscuro (sigue al sistema, sin interruptor); `:root[data-contrast="high"]` alto contraste |
| Dashboard (`paygent-dashboard/`) | `paygent-dashboard/src/styles.css` | `:root` claro; clase `.dark` en `<html>` desde Preferencias (por defecto claro, guardado en `localStorage`); Tailwind v4 los expone con `@theme inline` |
| App móvil (`mobile/`) | `mobile/src/lib/theme.ts` | `LIGHT` / `DARK` en hex sRGB (aproximación de los oklch de la web); `useColorScheme()` sigue al sistema |

No hay generador: **las tres copias se mantienen sincronizadas a mano**. Además, el fondo del ícono
adaptativo de Android (`#8E1B3A` en `mobile/app.config.ts`) es el vino claro del móvil.

## Tokens

Valores de `web/src/styles.css` y `paygent-dashboard/src/styles.css` (oklch) y de `mobile/src/lib/theme.ts` (hex).
"—" = el token no existe en esa copia.

| Rol | Web | Dashboard | Móvil | Claro (oklch) | Oscuro (oklch) | Móvil claro / oscuro |
|---|---|---|---|---|---|---|
| Fondo | `--background` | `--background` | `background` | `0.955 0.018 90` | `0.22 0.03 18` | `#F4F0E6` / `#2A1A1B` |
| Texto | `--foreground` | `--foreground` | `foreground` | `0.28 0.03 20` | `0.94 0.02 60` | `#3A2726` / `#F1E6DC` |
| Superficie / tarjeta | `--surface`, `--card` | `--card`, `--popover` | `surface` | `0.985 0.012 90` | `0.27 0.03 18` (popover del dashboard: `0.29 0.03 18`) | `#FBF8F0` / `#372526` |
| Apagado | `--muted` | `--muted` | `muted` | `0.9 0.035 60` | `0.31 0.03 25` | `#EDDCCB` / `#42302F` |
| Texto apagado | `--muted-foreground` | `--muted-foreground` | `mutedForeground` | `0.47 0.035 30` | `0.78 0.035 50` | `#6E5751` / `#CDB8A9` |
| Borde | `--border` | `--border` (`--input`: `0.84 0.03 55` / `0.42 0.035 25`) | `border` | `0.86 0.03 55` | `0.4 0.035 25` | `#DCCBBD` / `#5A4442` |
| Vino: acción | `--action` | `--primary` | `action` | `0.44 0.17 18` | `0.5 0.17 20` | `#8E1B3A` / `#A3284A` |
| Texto sobre vino | `--action-foreground` | `--primary-foreground` | `actionForeground` | `0.98 0.01 90` | `0.98 0.01 90` | `#FCF9F2` / `#FCF9F2` |
| Vino como texto (enlaces) | `--action-text` | — (usa `--accent-foreground`: `0.4 0.15 18` / `0.85 0.08 20`) | `actionText` | `0.44 0.17 18` | `0.8 0.1 20` | `#8E1B3A` / `#E8A3A8` |
| Azul PayPal | `--paypal` | — (solo como serie `--chart-4`) | `paypal` | `0.5 0.19 254` | `0.72 0.14 254` | `#0057C8` / `#6FA5F5` |
| Texto sobre azul | `--paypal-foreground` | — | `paypalForeground` | `0.99 0 0` | `0.16 0.03 254` | `#FFFFFF` / `#0C1A2E` |
| Éxito / PAGADO | `--success` | `--success` (`--success-soft`) | `success` | `0.47 0.11 165` | `0.66 0.13 165` | `#0F6F55` / `#3FB58E` |
| Verificado (PayPal) | — | `--verified` | — (usa `action`) | `0.47 0.11 165` | `0.66 0.13 165` | — |
| Autodeclarado | — | `--declared` | — (usa `mutedForeground` al 45 %) | `0.5 0.14 300` | `0.74 0.12 300` | — |
| Destructivo | `--destructive` | `--destructive` (`--danger-soft`) | `destructive` | `0.5 0.19 22` | `0.7 0.17 22` | `#A8262F` / `#F07A78` |
| Aviso | `--warning` | `--warning` (`--warning-soft`, `--warning-foreground`) | `warning` | web `0.52 0.12 65`, dashboard `0.72 0.15 75` | web `0.8 0.13 75`, dashboard `0.8 0.14 80` | `#8A5A10` / `#F0C060` |
| Anillo de foco | `--ring` | `--ring` | — | `0.44 0.17 18` | `0.72 0.14 20` | — |

Solo en el dashboard: `--secondary`, `--accent`, la familia `--sidebar-*`, sombras `--shadow-soft-v` /
`--shadow-lift-v` y siete series de gráfica `--chart-1` … `--chart-7` (vino, verde, tinto, azul PayPal, cian,
morado, ámbar).

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
3. **Verde = confirmado por el proveedor**: la pantalla PAGADO y lo verificado (captura PayPal).
4. **Morado con trama = autodeclarado**: efectivo, confirmado por la vendedora e importación de estado de
   cuenta. La trama (`hatch`, `hatch-soft`, `hatch-on-wine`: rayas a 45°) hace que no dependa solo del color
   (WCAG 1.4.1). Verificado y autodeclarado se muestran juntos pero **nunca se suman**.
5. **Ámbar = por confirmar** (`pending_bank` en el dashboard): nunca verde, nunca cuenta como pagado.
6. **Rojo destructivo**: reembolsos, rechazos y errores.
7. En alto contraste (web) todo se reduce a negro, blanco y amarillo; el significado lo cargan texto e íconos.

## Tamaños táctiles

- Web: `--touch: 56px` como alto o ancho mínimo de botones, teclas del teclado y pasos del carrito.
- Móvil: `TOUCH = 56` (pt).
- Dashboard: mínimo 44 px (`min-h-11`), la mayoría 48–56 px (`min-h-12`, `h-12`, `h-14`).
- Todo supera el mínimo AA de WCAG 2.2 (2.5.8, 24 px); las acciones de dinero usan 56.

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
