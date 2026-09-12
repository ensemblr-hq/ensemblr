# Bundled fonts

JetBrainsMono Nerd Font Mono files come from the Nerd Fonts v3.4.0 JetBrainsMono release archive:

https://github.com/ryanoasis/nerd-fonts/releases/download/v3.4.0/JetBrainsMono.tar.xz

The archive ships TrueType. Each face is converted once with Google's
`woff2_compress` (`brew install woff2`) and only the WOFF2 is committed — the
four `.ttf` files were 9.43 MB against 4.00 MB compressed, and they ship inside
the `.dmg`/`.AppImage` rather than over a network, so the raw size is the cost.

```
woff2_compress JetBrainsMonoNerdFontMono-Regular.ttf
```

WOFF2 is a container: Chromium decodes it to the same SFNT a `.ttf` load
produces, so nothing downstream can tell them apart. Measured in Electron 44
against `Mg@%#│█` (Latin, a Nerd Font private-use glyph, and a box-drawing
cell), the WOFF2 and TrueType faces ink an identical 5,811 canvas pixels at an
identical 230px advance, where the fallback `monospace` inks 4,563 at 279 — so
the xterm texture atlas that `.claude/rules/stack.md` documents rasterizes from
one exactly as from the other.

Bundled files:

- `JetBrainsMonoNerdFontMono-Regular.woff2`
- `JetBrainsMonoNerdFontMono-Bold.woff2`
- `JetBrainsMonoNerdFontMono-Italic.woff2`
- `JetBrainsMonoNerdFontMono-BoldItalic.woff2`

License: SIL Open Font License 1.1. See `JetBrainsMonoNerdFontMono-OFL.txt`.
