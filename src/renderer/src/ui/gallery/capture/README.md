# Gallery capture

The kit's own page — every component and every designed variant — served on its own so a change to
the kit can be **shot and scored** rather than read.

```sh
npx vite --config src/renderer/src/ui/gallery/capture/vite.config.mts
# http://localhost:5198/gallery-capture.html
# http://localhost:5198/gallery-capture.html?theme=dark
```

`?theme=dark` draws the page on the dark palette — the same switch the toggle in the corner
flips, seeded so a screenshot never has to click it.

The page it draws is `design/html/components.html`'s. `pnpm dev` draws the same gallery at
`index.html?gallery`, but through `main.tsx`, which needs the preload bridge; this harness needs
nothing but the browser.

## In the baseline, both themes (T209)

`pnpm design:baseline` shoots this page twice — `kit-gallery` and `kit-gallery-dark`, at the page's
own 1512x3890 — because the kit is where a migration is most likely to move a pixel nobody is
watching: a card or a table cell that shifts here shifts on every screen at once.
