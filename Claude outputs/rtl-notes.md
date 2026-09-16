# RTL / bidi notes

How Hebrew and Arabic are handled end to end: what we store, what we render, what
we compare. Read this before touching `app/i18n/normalize.py` or `TypingBox.tsx`.

## 1. What you see is what you type (ADR-013)

Every text goes through `normalize(text, language)` once, at import, and the result
is stored in **both** `content` and `content_normalized`. The page shows `content`;
the validator replays keystrokes against `content_normalized`; they are the same
string, so a text can never be unfinishable because of an invisible difference.

Shared rules: NFKC, drop zero-width/bidi control characters, curly quotes and
guillemets → `'` `"`, en/em dash → `-`, collapse whitespace.

| Hebrew | Arabic |
|---|---|
| Niqqud + cantillation stripped (combining marks in U+0590–U+05FF) | Tashkeel, dagger alef, Quranic marks stripped (combining marks in the Arabic blocks) |
| `׳` `״` `־` `׃` → `'` `"` `-` `:` | Tatweel `ـ` removed; alef wasla `ٱ` → `ا` |
| Yiddish ligatures `װ ױ ײ` → `וו וי יי` | Persian/Urdu look-alikes `ک ی ھ` → `ك ي ه` |
| **Final letters strict**: ך≠כ ם≠מ ן≠נ ף≠פ ץ≠צ | `,` `;` `?` → `،` `؛` `؟` (what the Arabic keyboard types) |
| | **Letters strict**: أ≠ا, ة≠ه, ى≠ي |

Why strict: those are separate keys on the keyboard, and a typing trainer that
accepts the wrong key is not measuring typing. A lenient mode would be one extra
translation table in `normalize.py`.

Corpus rules for v1: texts are unpointed and contain **no Latin letters and no
digits** inside Hebrew/Arabic sentences. Mixed-direction runs (bidi) are the one
thing the renderer below cannot show unambiguously with a per-character caret, so
we simply do not author them. The English corpus stays ASCII-only.

## 2. Rendering (ADR-014)

The typing box renders **one `<span>` per character**, the same as for English.

The M2 plan assumed this would break Arabic letter joining and planned an overlay
renderer (whole-word text nodes + caret positioned by `Range.getBoundingClientRect`).
We tested before building it: Chromium shapes cursive text across inline element
boundaries as long as every span has the same font properties, and a per-character
Arabic sentence renders pixel-identical in width to the same sentence as one text
node. Firefox has done the same for years, and WebKit fixed it for complex scripts
in late 2025 (bug 6148). So the overlay renderer was never written.

What *does* differ per language:

- `dir="rtl"` and `lang="he"|"ar"` on the typing box and on the hidden `<input>`.
- The font follows `lang` via CSS `:lang()` in `index.css`: Noto Sans (Latin),
  Noto Sans Hebrew, Noto Naskh Arabic — self-hosted from `@fontsource/*`, one
  script subset each, so nothing is fetched from Google.
- Naskh is drawn smaller and lower than Latin at the same `font-size`, so the
  Arabic box gets `font-size: 1.15em; line-height: 2`.
- Nothing in the typing box is monospace: monospace Hebrew/Arabic fonts are rare
  and ugly, and per-character colouring does not need equal widths.

Rules that keep shaping intact — do not break them:

1. All character spans share the same `font-family`, `font-size`, `font-weight`
   and `font-style`. Colour, background, border and border-radius are fine.
2. No `letter-spacing` on the typing text (it visibly breaks joins in every browser).
3. No per-character `display: inline-block` (that *does* isolate each glyph).

## 3. Layout

- Tailwind **logical** utilities only in shared components: `ms-`/`me-`, `ps-`/`pe-`,
  `text-start`/`text-end`, `start-`/`end-`. No `ml-`/`text-left`/`left-`. When the
  UI language becomes switchable (M3 step 3), `<html dir>` flips and everything
  mirrors without further work.
- The practice-text language and the UI language are two different settings. A
  Hebrew speaker may practise English typing in a Hebrew UI. The text language is
  chosen with the picker on the practice page and remembered in `localStorage`
  (`practice.language`); the UI language is i18next's.

## 4. Keyboard layouts (for the M5 heatmap)

Key-to-character maps for the three reference layouts live as JSON next to the
heatmap component when it is built: US QWERTY, Hebrew SI-1452, Arabic 101. The
heatmap groups per-character stats by physical key, so a Hebrew `ש` and an
English `a` colour the same key.

## 5. Things we tested by hand

- Arabic per-character spans vs one text node: identical width (357 px at 32 px)
  in Chromium, letters joined, colours and caret underline visible.
- The same for Hebrew (414 px), which has no joining but does have final forms.
- Practice page screenshots in en/he/ar with a typo mid-sentence: red highlight
  and caret land on the right character in all three directions.
