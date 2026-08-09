import { AGENT_PROVIDER_BRAND } from '@/renderer/components/agent-provider-brand-marks';
import { cn } from '@/renderer/lib/utils';
import type { AgentProviderId } from '@/shared/agent-provider';

/** The runtime's mark on its own, drawn in `currentColor` at the caller's size. */
export function AgentProviderLogo({
	className,
	provider,
}: {
	provider: AgentProviderId;
	className?: string;
}) {
	const { Logo } = AGENT_PROVIDER_BRAND[provider];

	return <Logo className={cn('size-4', className)} />;
}

/**
 * Square brand tile for one agent runtime, at the same scale the onboarding
 * check cards use so the wizard and the Providers tab read as one surface.
 */
export function AgentProviderBrandTile({
	className,
	provider,
}: {
	provider: AgentProviderId;
	className?: string;
}) {
	const { Logo, tint } = AGENT_PROVIDER_BRAND[provider];

	return (
		<span
			className={cn(
				'flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-foreground/5',
				tint,
				className,
			)}
		>
			<Logo className='size-4.5' />
		</span>
	);
}
