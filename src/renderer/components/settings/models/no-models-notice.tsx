import { Link } from '@tanstack/react-router';
import { TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { buttonVariants } from '@/renderer/components/ui/button';

/**
 * Warning shown when no agent runtime reported a single model.
 *
 * Pi answers `--list-models` with prose rather than a table when no provider is
 * configured, so a pi that is installed and detected still contributes nothing —
 * and with Claude Code absent as well there is no model for a chat to open on.
 * The remaining runtime states are per-runtime, so the notice sends the user to
 * Providers rather than guessing which half is broken.
 */
export function NoModelsNotice() {
	const { t } = useTranslation();

	return (
		<div className='flex flex-col items-start gap-2 rounded-xl border border-status-warning/30 bg-status-warning/10 px-4 py-3'>
			<p className='flex items-center gap-2 font-medium text-sm text-status-warning'>
				<TriangleAlertIcon className='size-4 shrink-0' />
				{t('settings:models.none-available.title', 'No models available')}
			</p>
			<p className='max-w-prose text-pretty text-muted-foreground text-xs'>
				{t(
					'settings:models.none-available.description',
					'No agent runtime reported a model. Pi lists none until at least one provider is configured, and Claude Code has to be installed separately. Set one up, then reopen this page.',
				)}
			</p>
			<Link
				className={buttonVariants({ size: 'sm', variant: 'outline' })}
				to='/settings/providers'
			>
				{t('settings:models.none-available.action', 'Open Providers')}
			</Link>
		</div>
	);
}
