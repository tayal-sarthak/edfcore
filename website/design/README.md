# Design sources

Not served. Only `public/` is, so the site still ships one image rather than two.

## `og.svg` — the share card

The source for `public/og.png`, the 1200x630 card every link preview renders. Kept because that
PNG is otherwise an orphan binary: the next person to reword it would have to redraw it.

The canvas is **1200x1200 with the card in its middle band**, which is what makes the two commands
below work. Quick Look always renders a square thumbnail, so a 1200x630 source is scaled to fill
and crops wrong.

```bash
cd website
qlmanage -t -s 1200 -o design design/og.svg
sips -c 630 1200 design/og.svg.png --out public/og.png && rm design/og.svg.png
```

Keep the wordmark and the line under it inside the middle 1080x600 — the region no platform crops.
Anything the card claims has to match the page; `og:image:alt` in `src/layouts/Base.astro`
describes this image and moves with it.
