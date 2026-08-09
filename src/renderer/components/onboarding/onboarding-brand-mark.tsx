import type { ReactElement } from 'react';

import { AGENT_PROVIDER_BRAND } from '@/renderer/components/agent-provider-brand';
import {
	GithubLogo,
	LinearLogo,
} from '@/renderer/components/workbench-shell/source-provider-logo';
import { cn } from '@/renderer/lib/utils';
import type { OnboardingCheckId } from '@/renderer/types/onboarding';

/**
 * Brand identity for one probe: which mark to draw, and the tint the card tile
 * wears. The agent runtimes reuse the shared provider marks so the wizard and
 * Settings → Providers never drift; Linear's indigo is the vendor's own literal
 * because it does not belong in the app's theme tokens.
 */
const BRAND: Record<
	OnboardingCheckId,
	{ Logo: (props: { className?: string }) => ReactElement; tint: string }
> = {
	'claude-executable': AGENT_PROVIDER_BRAND.claude,
	'gh-auth': { Logo: GithubLogo, tint: 'bg-foreground/8 text-foreground/85' },
	'gh-cli': { Logo: GithubLogo, tint: 'bg-foreground/8 text-foreground/85' },
	'linear-oauth': {
		Logo: LinearLogo,
		tint: 'bg-[#5e6ad2]/14 text-[#6b77e0]',
	},
	'pi-executable': AGENT_PROVIDER_BRAND.pi,
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
