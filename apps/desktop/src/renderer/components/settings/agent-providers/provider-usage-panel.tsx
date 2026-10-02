import { useTranslation } from 'react-i18next';

import { Progress } from '@/renderer/components/ui/progress';
import {
	planWindowLabel,
	planWindowResetLabel,
} from '@/renderer/lib/plan-limit-text';
import type { AgentProviderUsageWire } from '@/shared/ipc/contracts/agent-provider';

/** Stands in for a window the runtime named but reported no reading for. */
const UNKNOWN_UTILIZATION = '—';

/**
 * Plan rate-limit windows for the signed-in account, one bar each.
 *
 * A session that plan limits do not apply to — an API key, Bedrock, Vertex — is
 * told so in words rather than shown a column of empty gauges, because zero
 * consumed and no ceiling to consume against are different answers.
 */
export function ProviderUsagePanel({
	usage,
}: {
	usage: AgentProviderUsageWire;
}) {
	const { t } = useTranslation();

	if (!usage.available) {
		return (
			<p className='text-muted-foreground text-xs'>
				{t(
					'settings:providers.usage.not-applicable',
					'This session authenticates outside a claude.ai plan, so no plan limits apply to it.',
				)}
			</p>
		);
	}

	if (usage.limits.length === 0) {
		return (
			<p className='text-muted-foreground text-xs'>
				{t(
					'settings:providers.usage.empty',
					'The provider reported no plan limits.',
				)}
			</p>
		);
	}

	return (
		<ul className='divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/40'>
			{usage.limits.map((window) => {
				const resets = planWindowResetLabel(window.resetsAt, t);
				return (
					<li className='flex flex-col gap-1.5 px-3 py-2.5' key={window.id}>
						<div className='flex items-baseline justify-between gap-4'>
							<span className='min-w-0 truncate text-foreground text-xs'>
								{planWindowLabel(window, t)}
							</span>
							<span className='shrink-0 text-muted-foreground text-xs tabular-nums'>
								{window.utilization === null
									? UNKNOWN_UTILIZATION
									: `${Math.round(window.utilization)}%`}
							</span>
						</div>
						<Progress
							className='h-1.5 bg-muted'
							value={window.utilization ?? 0}
						/>
						{resets ? (
							<span className='text-muted-foreground text-xs'>{resets}</span>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}
