# Clarity pass prototype

This folder is the clarity pass prototype: the current design, taken as real HTML, to
prototype clearer navigation, tabs and buttons on. `pristine/` are frozen captures of main
on 2026-09-28 and are never edited; they are the reference. `screens/` start as byte-for-byte
copies and carry the prototype hooks. Both load fonts and images from `../assets/`.

Screens: `dashboard` (/), `games` (/games), `game` (/games/3000), `stats` (/stats),
`notes` (/notes), `explorer` (/explorer), `import` (/library/import).

## How they were captured

Each route of the read-only demo was loaded in headless Chromium at 1440x900, dark theme,
tour dismissed, and left until the network was idle plus 2.5 s, so the tables, board and
charts had drawn. Then `document.documentElement.outerHTML` was serialized. Vite injects the
stylesheet as `<style>` tags, so all CSS (Tailwind, chessground, both theme palettes) is
inline in each file. The capture made these changes:

- It removed every `<script>`, so the files render with JavaScript off.
- It downloaded the Geist, Geist Mono and Noto Symbols fonts, the logo and the favicons into
  `assets/`. The chess pieces and board are data URIs and stay inline.
- It copied form state (input values, checkboxes, selected options) into attributes.
- It turned a `<p>` holding block content (the Stats Progress footer) into a
  `<div data-was-p>`, because the HTML parser would otherwise split it.
- It pointed rail links at the other captured files (`games.html` and so on). Links to
  screens that were not captured go to `#`, and the original route is kept in
  `data-app-href`.
- It added one `<style data-capture-fix="theme-toggle">`, so the header's theme switch shows
  the right button pressed in either theme.

## Fidelity

Each file was screenshotted from `file://` with JavaScript disabled, in dark and in light,
and compared with the live page at 1440x900 (ImageMagick, 3% fuzz). Dashboard, Games, Notes
and Import match to 0 pixels. Game, Stats and Explorer differ by fewer than 25 pixels,
all anti-aliasing on text or bar edges.

Known limits: nothing is interactive. Menus, popovers, tooltips and the command palette do
not open, and hover styles are CSS only. Scroll positions are the top of each pane. Relative
times ("analysed 23d ago") are frozen at the capture date.

## Switching theme

The app keys its theme off the class on `<html>`: `dark` (the default, as captured) or
`light`, with `data-theme` and `color-scheme` kept alongside. In the browser console:

```js
const r = document.documentElement
const light = r.classList.contains('dark')
r.classList.replace(light ? 'dark' : 'light', light ? 'light' : 'dark')
r.dataset.theme = light ? 'light' : 'dark'
r.style.colorScheme = light ? 'light' : 'dark'
```

To make a file open in light, edit its opening tag to
`<html lang="en" class="light" data-theme="light" style="color-scheme: light">`.

## The proposal overlay

`index.html` is the viewer. Each `screens/<screen>.html` links `../clarity.css`, its own
`../clarity-<screen>.css` and `../clarity.js`, and reads its state from the query:
`?clarity=1&theme=dark&tabs=a&segment=a&shell=a&collections=a`. Every proposal rule is scoped to
`html.clarity`, so `?clarity=0` is the captured page to the pixel. The hook classes are listed at
the top of `clarity.css`.

One more parameter, not a decision: `games.html?…&pin=1` shows Games as the place of the first
pinned collection (the rail lights its row under Collections and the title reads
`Collections › League 2026`). Clicking a pinned row on the Games screen does the same. The
pinned collections are samples: the demo library has none.
