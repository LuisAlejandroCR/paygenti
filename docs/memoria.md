<!-- docs/memoria.md: bitácora de paygent — decisiones tomadas, por qué, y qué pasó en cada bloque.
     No es la spec (docs/plan.md, criterios de aceptación) ni la portada (README.md).
     Entradas nuevas arriba, fechadas; nunca se reescribe una entrada vieja, se corrige con otra. -->

# Memoria — paygent

## 2026-10-06 — Bloque 3 (núcleo): voz → carrito en `server/voice/`

- Parser por reglas determinista (`rules.ts`): números en español hasta «veinte», dígitos, «media
  docena», «un par», «otro»; plurales por un stem crudo (quita `s` y luego `e`: «atoles» = «atole»);
  gana el alias/nombre más largo contenido en el fragmento; empate = ambiguo → `unmatched`.
- «con» y «más» no separan fragmentos (rompían «rajas con queso»); un número a mitad de frase sí abre
  fragmento nuevo («dos de dulce tres verdes»).
- Camino Claude (`llm.ts`): Messages API por `fetch` inyectable, sin SDK; herramienta forzada
  `set_cart`, salida validada con zod y filtrada contra el catálogo; el texto dictado va dentro de
  `<order>` con `<`/`>` neutralizados. `index.ts` cae a reglas ante error, timeout (4 s) o vacío.
- Batería: 12/12 con el parser por reglas. ⏳ Falta la ruta HTTP y la UI (después de Bloque 1).

## 2026-10-06 — Bloque 0: scaffold

- La idea viene del repo `paygenty` (BRAINSTORM.md, §6–§7). Se congela en `docs/plan.md` con seis
  bloques; cada bloque es un PR que pasa `npm run check` antes del merge.
- Decisiones abiertas del BRAINSTORM resueltas por defecto para no bloquear: persona en México (MXN),
  hardware T0/T1 (QR y sticker), sin HCE ni soundbox hasta cerrar la rebanada.
- `docs/` se versiona mientras el repo sea privado. ⏳ Antes de hacerlo público, decidir si `docs/`
  sale del repo (el procedimiento de documentación lo trata como privado).
- Sin keys todo corre contra `MockPayPal`: el jurado no necesita configurar nada.
