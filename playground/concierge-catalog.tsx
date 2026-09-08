import {
	ConciergeMarkConsole,
	ConciergeMarkCurrent,
	ConciergeMarkGhostMono,
	ConciergeMarkHub,
	ConciergeMarkOrbit,
	ConciergeMarkRank,
	ConciergeMarkSigil,
} from './concierge-mark-variants.tsx';

/**
 * The candidates, in the order the scene lays them out: the shipped mark first
 * as the control, then the six, ordered by how far each departs from it.
 *
 * `tradeoff` is the honest cost of each one rather than a caveat — a review that
 * only reads the case for a variant is a review of six pitches.
 *
 * Kept apart from `concierge-mark-variants.tsx` so that file exports components
 * alone and stays a Fast Refresh boundary. The marks are judged by nudging their
 * geometry with the scene open, which a full reload would cost. The launcher
 * shapes below share this file for the same reason.
 */
export const CONCIERGE_MARK_VARIANTS = [
	{
		id: 'current',
		label: 'Current',
		Mark: ConciergeMarkCurrent,
		note: 'Shipped today. A centre cell with three orbiting it, rounded at 0.32 of the cell.',
		tradeoff:
			'The composition is the default assistant/spinner glyph, and the rounding is twice the app icon’s, so it reads as a generic squircle rather than a dot-matrix pixel.',
	},
	{
		id: 'orbit',
		label: 'Orbit',
		Mark: ConciergeMarkOrbit,
		note: 'The same composition re-cut at the icon’s 0.16 corner radius, with the dimmest satellite lifted to 0.6 so it survives 16px.',
		tradeoff:
			'Fixes the rounding and nothing else — still one dot with three satellites, which is the part that reads as generic.',
	},
	{
		id: 'hub',
		label: 'Hub',
		Mark: ConciergeMarkHub,
		note: 'A lead cell with four reporting into it from the corners. Four-fold symmetric, so a rotation of it looks like a rest and it never reads as a spinner.',
		tradeoff:
			'A quincunx is a common enough arrangement that it can read as a die face; the corner cells are also the smallest of any candidate at 16px.',
	},
	{
		id: 'rank',
		label: 'Rank',
		Mark: ConciergeMarkRank,
		note: 'One cell above a row of three — the one agent above every workspace, drawn literally. Four cells total, the sparsest here.',
		tradeoff:
			'Reads as hierarchy rather than as an agent, and the row could be mistaken for a menu or a list glyph at small sizes.',
	},
	{
		id: 'console',
		label: 'Console',
		Mark: ConciergeMarkConsole,
		note: 'A 3×3 field with one cell lit and enlarged at its head. Fills its box, so it carries weight on the launcher bubble.',
		tradeoff:
			'A filled 3×3 grid is close to the universal app-launcher glyph; the eight dim cells also depend on holding 0.35 opacity against the accent fill.',
	},
	{
		id: 'ghost',
		label: 'Ghost',
		Mark: ConciergeMarkGhostMono,
		note: 'A 2×2 pixel core with the icon’s chromatic split behind it. Carries the most identity per pixel of anything here.',
		tradeoff:
			'In one colour the split is subtle enough to read as a blur; tinted it is unmistakable but stops being a currentColor glyph, so it cannot take the accent fill or the header’s muted grey.',
	},
	{
		id: 'sigil',
		label: 'Sigil',
		Mark: ConciergeMarkSigil,
		note: 'The dot-matrix E at 3×5, spine lit and arms held back. The closest tie to the app icon.',
		tradeoff:
			'The E is the product’s mark — a feature wearing it competes with the icon rather than sitting under it. Eleven cells is also the densest here, so 16px is where it has to be judged.',
	},
] as const;

/**
 * The shapes the launcher bubble could take, shipped one first as the control.
 *
 * `shapeClassName` carries the corner treatment alone and `sizeClassName` the
 * footprint, because the sheen is a separate child that has to round itself to
 * the same corners — the shipped launcher deliberately omits `overflow-hidden`
 * so the unread badge on the bubble's shoulder is not clipped in half, which
 * means nothing clips the sheen to the bubble either.
 *
 * Two candidates lean on `corner-shape`, which Chromium shipped in 139. Electron
 * 44.1.1 embeds Chromium 152.0.7977.65, so both are available in the packaged
 * app rather than only in the dev browser.
 */
export const LAUNCHER_SHAPES = [
	{
		id: 'circle',
		label: 'Circle',
		shapeClassName: 'rounded-full',
		sizeClassName: 'size-11',
		note: 'Shipped today. A 44px `rounded-full` bubble.',
		tradeoff:
			'The floating circle is the default FAB shape, and it is close to the only round thing in an app whose icon, cards, dialogs and dot-matrix cells are all rounded rectangles.',
	},
	{
		id: 'squircle',
		label: 'Squircle',
		shapeClassName: 'concierge-shape-squircle',
		sizeClassName: 'size-11',
		note: 'The superellipse the app icon’s own body is cut from, via `corner-shape: squircle` at a full radius. The launcher becomes a miniature of the icon silhouette.',
		tradeoff:
			'Where `corner-shape` is unsupported the `border-radius: 50%` under it resolves on a square box to exactly the circle this replaces, so that regression would be silent rather than visible.',
	},
	{
		id: 'pixel',
		label: 'Pixel',
		shapeClassName: 'rounded-lg',
		sizeClassName: 'size-11',
		note: 'An 8.8px radius on 44 — `rounded-lg` resolves to this theme’s `--radius: 0.55rem`, not Tailwind’s default 8px. The toggle becomes one scaled-up dot-matrix cell, the same grammar as the mark inside it, though the icon’s own 0.16 cell ratio would be 7.04px and `rounded-md` (6.6px) is the nearer step.',
		tradeoff:
			'The sharpest of the six: at 44px it reads more like a tool button than a floating agent, and it competes with the mark’s own cells for the same corner language.',
	},
	{
		id: 'chrome',
		label: 'Chrome',
		shapeClassName: 'rounded-xl',
		sizeClassName: 'size-11',
		note: 'A 10.56px radius on 44 — `rounded-xl`, which is what the app’s cards and dialogs genuinely use (`src/renderer/components/ui/card.tsx`, `src/renderer/components/ui/dialog.tsx`). Sits one step under Soft.',
		tradeoff:
			'Two steps of radius apart from Soft is a difference you have to look for. It buys consistency with the chrome rather than a distinct silhouette, so it wins on argument rather than on sight.',
	},
	{
		id: 'soft',
		label: 'Soft',
		shapeClassName: 'rounded-2xl',
		sizeClassName: 'size-11',
		note: 'A 13.2px radius on 44 — one step above the `rounded-xl` (10.56px) the app’s cards and dialogs actually use. `rounded-2xl` appears once in the whole renderer, so this is near the chrome’s radius rather than a reuse of it.',
		tradeoff:
			'Safe rather than distinctive. It reads as a panel that happens to float — and since it does not land on the chrome’s own token, it borrows the look without the consistency that would justify it.',
	},
	{
		id: 'bevel',
		label: 'Bevel',
		shapeClassName: 'concierge-shape-bevel',
		sizeClassName: 'size-11',
		note: 'Chamfered rather than curved, via `corner-shape: bevel`. The most CRT-adjacent of the six and the only one that answers the dot-matrix language without a curve.',
		tradeoff:
			'Nothing else in the app is chamfered, so it introduces a corner treatment rather than reusing one, and the flats read as an octagon before they read as a bevel.',
	},
	{
		id: 'capsule',
		label: 'Capsule',
		shapeClassName: 'rounded-full',
		sizeClassName: 'size-11 w-14',
		note: 'A 56×44 pill — a control rather than an orb, which is what a docked affordance usually looks like.',
		tradeoff:
			'The only candidate that changes the footprint. `LAUNCHER_SIZE` in `src/renderer/components/concierge/concierge-launcher.tsx` already carries width and height separately, so picking this is a one-line change there rather than a rewrite — but it is the one shape that is not just a class swap.',
	},
] as const;

/**
 * The colour treatments the bubble could wear, shipped one first as the control.
 *
 * Three of them are the app icon's own body — a dark squircle with a faint rim
 * and a light glyph — because the icon is the one place Ensemblr has already
 * answered what this object looks like in colour. They differ only in what
 * happens to the glyph on top of it, which is where the icon's own artwork does
 * its work too.
 *
 * `fillClassName` is empty for Primary rather than naming a class: the control
 * has to be whatever the shipped `Button` variant gives, not a copy of it that
 * could drift.
 */
export const LAUNCHER_FILLS = [
	{
		id: 'primary',
		label: 'Primary',
		fillClassName: '',
		note: 'Shipped today. The Button’s default variant — a flat `bg-primary`, which is near-white in dark mode and near-black in light.',
		tradeoff:
			'Carries no colour of its own, so the bubble reads as a generic control rather than as this app’s agent. It is also the highest-contrast thing on the canvas, which is a lot of weight for something that floats over the work.',
	},
	{
		id: 'accent',
		label: 'Accent',
		fillClassName: 'concierge-fill-accent',
		note: 'A flat fill in `--ensemblr-accent`, the hue the app already spends on links, focus rings and the sheen. The glyph takes `--ensemblr-accent-foreground`.',
		tradeoff:
			'The accent is a text colour before it is a fill — the token’s own comment says so — so a 44px disc of it is the largest block of that hue anywhere in the app, and it competes with every accent-tinted state around it.',
	},
	{
		id: 'gradient',
		label: 'Gradient',
		fillClassName: 'concierge-fill-gradient',
		note: 'The accent as a 145° gradient, lifted toward white at the top-left and dropped toward black at the bottom-right, so the bubble reads as lit from the window’s light rather than as a flat sticker.',
		tradeoff:
			'Nothing else in the app is gradient-filled, so it introduces a treatment rather than reusing one — and a gradient under a rotating conic sheen is two lighting models on one 44px object.',
	},
	{
		id: 'icon',
		label: 'Icon',
		fillClassName: 'concierge-fill-icon',
		note: 'The app icon’s own body: `oklch(0.135 0.006 35)` with the icon’s rim and its `oklch(0.91 0.006 75)` ink, straight from `scripts/icon-colors.mjs`. The launcher becomes a miniature of the thing in the Dock.',
		tradeoff:
			'Deliberately does not follow the theme, which costs it most of its distinctiveness in light mode: `bg-primary` is already near-black there, so Icon lands close to Primary and only the rim and the warmer ink separate them. It is a dark-mode proposal that merely survives light mode.',
	},
	{
		id: 'bloom',
		label: 'Bloom',
		fillClassName: 'concierge-fill-bloom',
		note: 'The Icon body with the icon’s emissive glow restored — `renderMaster` blurs the glyph and screens it back over the body, and a `drop-shadow` in the same ink is the cheap equivalent at 44px.',
		tradeoff:
			'The glow softens the glyph’s edges, which costs the dot-matrix crispness the marks were cut for. Worth checking against Console specifically, since its dim cells are already at 0.35.',
	},
	{
		id: 'chromatic',
		label: 'Chromatic',
		fillClassName: 'concierge-fill-chromatic',
		note: 'The Icon body with the wordmark’s cyan/red split applied to whichever glyph is on it, as a paired `drop-shadow`. Unlike the Ghost mark, this puts the split on every candidate rather than building it into one.',
		tradeoff:
			'Chained drop-shadows tint each other, so the split is muddier than the wordmark’s two clean layers, and a 1px offset is close to invisible at the 16px header size — this is a launcher-only treatment. It also lands hardest on cells held below full opacity: only a fully lit cell keeps a clean cyan-left/red-right edge, while a 0.35 cell absorbs both shadows and reads as flat purple. On Console that recolours the whole eight-cell field and flattens the lead-against-field hierarchy the mark is built on. Split, below, is the same idea without that cost.',
	},
] as const;
