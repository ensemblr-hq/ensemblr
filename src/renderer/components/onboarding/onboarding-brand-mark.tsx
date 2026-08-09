import type { ComponentProps, ReactElement } from 'react';

import {
	GithubLogo,
	LinearLogo,
} from '@/renderer/components/workbench-shell/source-provider-logo';
import { cn } from '@/renderer/lib/utils';
import type { OnboardingCheckId } from '@/renderer/types/onboarding';

// Claude's star mark, the `logos:claude-icon` art from @iconify-json/logos
// re-cut to fill with currentColor. Its source viewBox is 256×257, not the
// 24×24 the simple-icons marks in `source-provider-logo` share.
const CLAUDE_PATH =
	'm50.228 170.321l50.357-28.257l.843-2.463l-.843-1.361h-2.462l-8.426-.518l-28.775-.778l-24.952-1.037l-24.175-1.296l-6.092-1.297L0 125.796l.583-3.759l5.12-3.434l7.324.648l16.202 1.101l24.304 1.685l17.629 1.037l26.118 2.722h4.148l.583-1.685l-1.426-1.037l-1.101-1.037l-25.147-17.045l-27.22-18.017l-14.258-10.37l-7.713-5.25l-3.888-4.925l-1.685-10.758l7-7.713l9.397.649l2.398.648l9.527 7.323l20.35 15.75L94.817 91.9l3.889 3.24l1.555-1.102l.195-.777l-1.75-2.917l-14.453-26.118l-15.425-26.572l-6.87-11.018l-1.814-6.61c-.648-2.723-1.102-4.991-1.102-7.778l7.972-10.823L71.42 0l10.63 1.426l4.472 3.888l6.61 15.101l10.694 23.786l16.591 32.34l4.861 9.592l2.592 8.879l.973 2.722h1.685v-1.556l1.36-18.211l2.528-22.36l2.463-28.776l.843-8.1l4.018-9.722l7.971-5.25l6.222 2.981l5.12 7.324l-.713 4.73l-3.046 19.768l-5.962 30.98l-3.889 20.739h2.268l2.593-2.593l10.499-13.934l17.628-22.036l7.778-8.749l9.073-9.657l5.833-4.601h11.018l8.1 12.055l-3.628 12.443l-11.342 14.388l-9.398 12.184l-13.48 18.147l-8.426 14.518l.778 1.166l2.01-.194l30.46-6.481l16.462-2.982l19.637-3.37l8.88 4.148l.971 4.213l-3.5 8.62l-20.998 5.184l-24.628 4.926l-36.682 8.685l-.454.324l.519.648l16.526 1.555l7.065.389h17.304l32.21 2.398l8.426 5.574l5.055 6.805l-.843 5.184l-12.962 6.611l-17.498-4.148l-40.83-9.721l-14-3.5h-1.944v1.167l11.666 11.406l21.387 19.314l26.767 24.887l1.36 6.157l-3.434 4.86l-3.63-.518l-23.526-17.693l-9.073-7.972l-20.545-17.304h-1.36v1.814l4.73 6.935l25.017 37.59l1.296 11.536l-1.814 3.76l-6.481 2.268l-7.13-1.297l-14.647-20.544l-15.1-23.138l-12.185-20.739l-1.49.843l-7.194 77.448l-3.37 3.953l-7.778 2.981l-6.48-4.925l-3.436-7.972l3.435-15.749l4.148-20.544l3.37-16.333l3.046-20.285l1.815-6.74l-.13-.454l-1.49.194l-15.295 20.999l-23.267 31.433l-18.406 19.702l-4.407 1.75l-7.648-3.954l.713-7.064l4.277-6.286l25.47-32.405l15.36-20.092l9.917-11.6l-.065-1.686h-.583L44.07 198.125l-12.055 1.555l-5.185-4.86l.648-7.972l2.463-2.593l20.35-13.999z';

/** Inline Claude brand glyph, drawn in `currentColor`. */
function ClaudeLogo({ className, ...props }: ComponentProps<'svg'>) {
	return (
		<svg
			aria-hidden='true'
			className={className}
			fill='currentColor'
			role='presentation'
			viewBox='0 0 256 257'
			xmlns='http://www.w3.org/2000/svg'
			{...props}
		>
			<path d={CLAUDE_PATH} />
		</svg>
	);
}

// Pi's blocky "Pi" mark, traced from https://pi.dev/logo-auto.svg. The source
// art is monochrome and takes the ambient color, so it is recut to
// `currentColor` here rather than pinned to black. Its 800×800 canvas carries a
// far wider margin than the other marks, so the viewBox is cropped back to the
// glyph plus a matching inset — at the source framing Pi renders visibly
// smaller than Claude and GitHub beside it.
const PI_VIEW_BOX = '113 113 574 574';
const PI_STEM_PATH =
	'M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z';
const PI_DOT_PATH = 'M517.36 400H634.72V634.72H517.36Z';

/** Inline Pi brand glyph, drawn in `currentColor`. */
function PiLogo({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden='true'
			className={className}
			fill='currentColor'
			role='presentation'
			viewBox={PI_VIEW_BOX}
			xmlns='http://www.w3.org/2000/svg'
		>
			<path clipRule='evenodd' d={PI_STEM_PATH} fillRule='evenodd' />
			<path d={PI_DOT_PATH} />
		</svg>
	);
}

/**
 * Brand identity for one probe: which mark to draw, and the tint the card tile
 * wears. Colors are the vendors' own — Claude's terracotta and Linear's indigo
 * are literals because neither belongs in the app's theme tokens, while Pi
 * borrows Ensemblr's accent since it is the house runtime.
 */
const BRAND: Record<
	OnboardingCheckId,
	{ Logo: (props: { className?: string }) => ReactElement; tint: string }
> = {
	'claude-executable': {
		Logo: ClaudeLogo,
		tint: 'bg-[#d97757]/12 text-[#d97757]',
	},
	'gh-auth': { Logo: GithubLogo, tint: 'bg-foreground/8 text-foreground/85' },
	'gh-cli': { Logo: GithubLogo, tint: 'bg-foreground/8 text-foreground/85' },
	'linear-oauth': {
		Logo: LinearLogo,
		tint: 'bg-[#5e6ad2]/14 text-[#6b77e0]',
	},
	'pi-executable': {
		Logo: PiLogo,
		tint: 'bg-accent-strong/12 text-accent-strong',
	},
};

/**
 * Square brand tile for a check card. Keeps the vendor mark constant across
 * every outcome — status is carried by the pip and the badge beside it, so a
 * failing check still reads as *which* tool failed at a glance.
 */
export function OnboardingBrandTile({
	checkId,
	className,
	isMuted = false,
}: {
	checkId: OnboardingCheckId;
	className?: string;
	isMuted?: boolean;
}) {
	const { Logo, tint } = BRAND[checkId];

	return (
		<span
			className={cn(
				'flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-foreground/5 transition-colors duration-300',
				isMuted ? 'bg-pane-strong text-muted-foreground' : tint,
				className,
			)}
		>
			<Logo className='size-5' />
		</span>
	);
}

/**
 * The same mark at list scale, for the welcome screen's preview rows where
 * there is no status to report and the tile would be too loud.
 */
export function OnboardingBrandGlyph({
	checkId,
	className,
}: {
	checkId: OnboardingCheckId;
	className?: string;
}) {
	const { Logo } = BRAND[checkId];

	return <Logo className={cn('size-4', className)} />;
}

/**
 * The mark in its own tinted swatch at row scale. The welcome rows overlap two
 * of these for the either-or runtimes, so the ring is drawn in the card color
 * to cut the one behind it rather than outline both.
 */
export function OnboardingBrandSwatch({
	checkId,
}: {
	checkId: OnboardingCheckId;
}) {
	const { Logo, tint } = BRAND[checkId];

	return (
		<span
			className={cn(
				'flex size-8 items-center justify-center rounded-lg ring-2 ring-card',
				tint,
			)}
		>
			<Logo className='size-4' />
		</span>
	);
}
