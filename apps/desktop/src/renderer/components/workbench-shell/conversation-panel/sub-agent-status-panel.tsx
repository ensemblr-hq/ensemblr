import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

import {
	resolveComposerProvider,
	showContextIndicator,
} from '@/renderer/lib/workbench';
import { getThinkingStrength } from '@/renderer/lib/workbench/thinking-strength';
import { alwaysShowContextUsageAtom } from '@/renderer/state/preferences';
import type { ComposerShellState } from '@/renderer/types/workbench';

import { ContextIndicator } from './composer/context-indicator';
import { ThinkingBarIcon } from './composer/thinking-bar-icon';

/**
 * Read-only runtime readout that fills the composer's slot on a spawned
 * sub-agent's chat pane. That tab renders no composer — see `showsComposer` — so
 * the model, thinking level, and context gauge that normally live in the
 * composer's control row have nowhere else to surface, and a delegated child
 * would otherwise run entirely unattributed. It takes the composer's place in
 * the layout rather than floating over the timeline, so it occludes nothing.
 * Nothing here mutates the child; the orchestrator that spawned it still owns
 * every setting the panel reports.
 */
export function SubAgentStatusPanel({
	composer,
}: {
	composer: ComposerShellState;
}) {
	const { t } = useTranslation();
	const alwaysShowContextUsage = useAtomValue(alwaysShowContextUsageAtom);

	if (!composer.activeAgentSessionId) {
		return null;
	}

	const provider = resolveComposerProvider(composer);
	const strength = getThinkingStrength(provider, composer.thinkingLevel);

	return (
		<aside
			aria-label={t(
				'workbench:sub-agent-status.aria-label',
				'Sub-agent runtime',
			)}
			className='shrink-0 bg-background px-4 pt-2 pb-4'
			data-role='sub-agent-status'
		>
			<div className='mx-auto flex w-full max-w-4xl items-center justify-end gap-2 text-muted-foreground text-xxs'>
				<span className='font-medium text-foreground'>
					{composer.modelLabel}
				</span>
				<span aria-hidden='true' className='text-muted-foreground/50'>
					·
				</span>
				<span className='flex items-center gap-1.5'>
					<ThinkingBarIcon strength={strength} />
					<span>{composer.thinkingLabel}</span>
				</span>
				{showContextIndicator(composer, alwaysShowContextUsage) ? (
					<ContextIndicator usage={composer.contextUsage} />
				) : null}
			</div>
		</aside>
	);
}
