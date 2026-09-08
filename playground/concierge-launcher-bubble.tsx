import type { ReactNode } from 'react';

import { ConciergeUnreadBadge } from '@/renderer/components/concierge/concierge-unread-badge';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';

import type { MarkProps } from './concierge-mark-variants.tsx';

/**
 * Corner treatments Tailwind has no utility for, scoped to the playground so a
 * shape can be judged before anything is added to
 * `src/renderer/styles/index.css`.
 *
 * `corner-shape` decides the curve the `border-radius` is drawn with, so both
 * rules set a radius as well: at a full radius `squircle` gives the superellipse
 * the app icon's body is cut from, and at 30% `bevel` chamfers the corners
 * instead of rounding them. Chromium shipped the property in 139 and Electron
 * 44.1.1 embeds 152, so neither is dev-only — but an engine without it falls
 * back to plain `border-radius`, which turns the squircle into the very circle
 * it replaces.
 */
const SHAPE_STYLES = `
.concierge-shape-squircle {
  corner-shape: squircle;
  border-radius: 50%;
}
.concierge-shape-bevel {
  corner-shape: bevel;
  border-radius: 30%;
}
`;

/**
 * The colour treatments the bubble could wear, as raw CSS rather than utilities.
 *
 * Three of the five reach for values Tailwind has no utility for. The app icon's
 * body, rim and ink are literal `oklch()` triples from `scripts/icon-colors.mjs`
 * rather than theme tokens, because the icon is dark in both themes and
 * `--ensemblr-canvas` flips — a themed fill would stop being the icon in light
 * mode. `--ensemblr-accent-foreground` has no `--color-*` alias, so no
 * `bg-*`/`text-*` utility exists for it at all.
 *
 * What actually beats the `bg-primary` and `border-transparent` the Button
 * contributes is the cascade layer, not specificity. Tailwind emits its
 * utilities inside `@layer utilities`, this sheet is injected unlayered, and an
 * unlayered normal declaration wins against any layered one whatever its
 * specificity — measured here, a bare type selector at 0-0-1 overrides
 * `.bg-primary` at 0-1-0. The doubled selectors below are therefore belt and
 * braces rather than the mechanism: they cost nothing and would carry the win on
 * specificity alone if these rules ever moved into a layer.
 */
const FILL_STYLES = `
.concierge-fill-accent.concierge-fill-accent {
  background: var(--ensemblr-accent);
  color: var(--ensemblr-accent-foreground);
}
.concierge-fill-gradient.concierge-fill-gradient {
  background: linear-gradient(
    145deg,
    color-mix(in oklch, var(--ensemblr-accent) 82%, white),
    var(--ensemblr-accent) 55%,
    color-mix(in oklch, var(--ensemblr-accent) 74%, black)
  );
  color: var(--ensemblr-accent-foreground);
}
.concierge-fill-icon.concierge-fill-icon {
  background: oklch(0.135 0.006 35);
  border-color: oklch(0.31 0.006 35);
  color: oklch(0.91 0.006 75);
}
.concierge-fill-bloom.concierge-fill-bloom {
  background: oklch(0.135 0.006 35);
  border-color: oklch(0.31 0.006 35);
  color: oklch(0.91 0.006 75);
}
.concierge-fill-bloom svg {
  filter: drop-shadow(0 0 0.3125rem oklch(0.91 0.006 75 / 0.55));
}
.concierge-fill-chromatic.concierge-fill-chromatic {
  background: oklch(0.135 0.006 35);
  border-color: oklch(0.31 0.006 35);
  color: oklch(0.91 0.006 75);
}
.concierge-fill-chromatic svg {
  filter: drop-shadow(-0.0625rem 0 #22d3ee) drop-shadow(0.0625rem 0 #ff2e63);
}
.concierge-sheen-white {
  background-image: conic-gradient(
    from 0deg,
    transparent 0deg,
    oklch(0.97 0.005 75 / 0.35) 55deg,
    oklch(0.97 0.005 75 / 0.09) 130deg,
    transparent 200deg,
    transparent 360deg
  );
}
`;

/**
 * Publishes the shape and fill rules. Rendered once by the scene rather than by
 * each bubble, since a page showing forty bubbles would otherwise carry forty
 * copies of the same stylesheet.
 */
export function ConciergeLauncherShapeStyles() {
	return <style>{`${SHAPE_STYLES}${FILL_STYLES}`}</style>;
}

/**
 * The corner treatment and footprint one launcher candidate is drawn with.
 *
 * `sizeClassName` has to open with a `size-*` utility. It is merged over the
 * `size-8` that `size='icon'` contributes, and tailwind-merge's `size` conflict
 * is one-way — a later `size-*` displaces `w-*`/`h-*`, but a later `w-*`/`h-*`
 * leaves the earlier `size-*` in the class list, where only stylesheet order
 * decides the winner. A shape wanting a non-square footprint therefore states
 * the square first and overrides one axis after it, as Capsule's
 * `size-11 w-14` does.
 */
export interface LauncherShape {
	shapeClassName: string;
	sizeClassName: string;
}

/** The colour treatment one launcher candidate is drawn with. */
export interface LauncherFill {
	/** Empty for the shipped fill, which is whatever the Button's variant gives. */
	fillClassName: string;
}

/**
 * The launcher bubble as the app draws it, with the shape and the mark both
 * swappable.
 *
 * Everything here is lifted from `ConciergeLauncher` rather than restaged: the
 * shipped `Button`, the `concierge-sheen` utility, the shadow, and the real
 * `ConciergeUnreadBadge`. What it drops is the drag anchor and the panel — the
 * bubble is what is under review, not the surface it opens.
 *
 * `relative` is load-bearing and is the one thing the shipped launcher gets for
 * free: there it comes from `fixed`, which this scene has no use for, and
 * without a positioned ancestor both the sheen and the badge resolve against the
 * viewport instead of the bubble.
 *
 * The sheen sits inside its own clipping layer, and that is a fix the shipped
 * launcher still needs. The sheen rotates, which preserves a silhouette only
 * when the silhouette is a circle; on any other corner treatment the rotating
 * square's corners sweep outside the bubble and the conic gradient's bright arc
 * shows up beside it. `ConciergeLauncher` never hits this because it is
 * `rounded-full`, and it omits `overflow-hidden` on purpose so the unread badge
 * on the bubble's shoulder is not cut in half. Clipping the sheen alone keeps
 * both: the badge stays outside the clip, the sheen cannot escape.
 *
 * Only the sheen carries a `z-index`. `z-0` on its clipping layer puts it at the
 * bottom of the three, and DOM order settles the rest, which is verified by
 * paint rather than assumed. The mark must *not* be lifted to a positive
 * `z-index` to state the same thing: `ConciergeUnreadBadge` carries none of its
 * own, and a positioned element at `z-10` paints in a later step than one at
 * `auto`, so it would cover the badge. Measured — with the mark forced over the
 * badge's corner it hid it completely. The overlap is 5×5px and no current glyph
 * reaches into it, so that one is latent rather than visible, which is exactly
 * why it is written down.
 *
 * The sheen also has to stay quiet, and that is a constraint the z-order cannot
 * satisfy. Every mark holds its hierarchy in `fill-opacity` — Console's eight
 * field cells sit at 0.35, Hub's corners and Rank's row at 0.5, Sigil's arms at
 * 0.5 — so a bright arc *behind* them reads straight through the translucent
 * cells and washes out the very contrast that separates them from the lit one.
 * Turning the sheen up therefore looks like a stacking bug and is not one, and
 * the fix that suggests itself — making the cells opaque — would delete the
 * hierarchy instead. The stops are held at 0.35/0.09 against the shipped
 * accent sheen's 0.9/0.22, and the hover ceiling at 60 rather than 80, for that
 * reason and no other.
 *
 * The sheen itself is `concierge-sheen-white` rather than the shipped
 * `concierge-sheen`, which is the accent hue. Adopting it means changing the
 * `@utility concierge-sheen` block in `src/renderer/styles/index.css`, not just
 * this scene — the shipped utility's own comment argues for a single accent hue
 * on the grounds that mixing a second colour in leaves the disc a muddy wash,
 * and a white arc is exactly that second colour. The argument is real and points
 * the way the comment says: measured on the `Accent` fill, the lit region comes
 * back 4.5% *less* saturated than the unlit one, so white desaturates the accent
 * rather than lighting it. What defuses it is the strength — a third of the
 * shipped sheen's — and the fact that the fills under review are the icon's dark
 * body, where the same arc lights rather than washes. Both halves of that hold
 * only while the launcher wears a dark fill; swapping the utility while it still
 * wears the accent would land exactly in the case the comment warns about.
 *
 * **Whoever adopts a non-circular shape from this scene has to carry this
 * clipping layer into `src/renderer/components/concierge/concierge-launcher.tsx`
 * with it, or the bug ships.**
 */
export function LauncherBubble({
	badgeCount = 0,
	fill,
	isWorking = false,
	label,
	Mark,
	shape,
}: {
	badgeCount?: number;
	fill?: LauncherFill;
	isWorking?: boolean;
	label: string;
	Mark: (props: MarkProps) => ReactNode;
	shape: LauncherShape;
}) {
	return (
		<Button
			aria-label={label}
			className={cn(
				'relative shadow-lg',
				shape.shapeClassName,
				shape.sizeClassName,
				fill?.fillClassName,
			)}
			size='icon'
		>
			<span
				aria-hidden='true'
				className={cn(
					'pointer-events-none absolute inset-0 z-0 overflow-hidden',
					shape.shapeClassName,
				)}
			>
				<span className='concierge-sheen-white absolute -inset-1/4 opacity-0 transition-opacity duration-300 group-hover/button:opacity-60 motion-safe:animate-concierge-sheen' />
			</span>
			<Mark className='relative size-7' isWorking={isWorking} />
			<ConciergeUnreadBadge count={badgeCount} />
		</Button>
	);
}
