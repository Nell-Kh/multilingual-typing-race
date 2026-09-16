# RTL / bidi notes

Written up properly in M3. Placeholder so the plan is visible now.

## The core problem

The English renderer draws one `<span>` per character to colour it. Arabic letters
change shape depending on their neighbours (initial / medial / final / isolated),
and the browser only shapes letters that sit in the **same text node**. Splitting a
word into spans therefore breaks the joins: ‫مرحبا‬ renders as five isolated glyphs.

## Plan (M3)

- Render the target as whole words in one text node per word.
- Draw the caret and the correct/incorrect highlights as **overlays**, positioned with
  `Range.getBoundingClientRect()` on the character offsets — the text itself is
  never split.
- `<html dir="rtl">` for he/ar; Tailwind logical properties (`ms-`, `pe-`,
  `text-start`) everywhere so layout mirrors for free.
- Hebrew final letters (ך ם ן ף ץ) must match exactly; `׳`/`״` map to `'`/`"`.
- Arabic: strip tashkeel (U+064B–U+0652, U+0670) and tatweel (U+0640) at import;
  strict matching in v1 (أ ≠ ا).
- Corpus rule for v1: no mixed-direction content (no Latin words or digits inside
  he/ar texts).
- Keyboard layout maps for the heatmap: Hebrew SI-1452, Arabic 101, US QWERTY.

The engine (`features/typing-engine/engine.ts`) already handles he/ar characters as
single positions and is renderer-agnostic — only the display component changes.
