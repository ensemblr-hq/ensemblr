import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';

/**
 * Empty state for the Setup dock tab when no setup script is configured: an
 * "Ask agent" action that seeds the composer with a settings.toml setup prompt,
 * and an "Add manually" action that opens the repository's Scripts settings.
 *
 * The second action is outlined rather than secondary because the panel is
 * `bg-sidebar`, and in the light palette `--secondary` and `--sidebar` land
 * within 0.01 lightness of each other — the fill disappears into the surface.
 */
export function SetupMissingEmptyState({
	onAddManually,
	onAskAgent,
}: {
	onAddManually: () => void;
	onAskAgent: () => void;
}) {
	const { t } = useTranslation();

	return (
		<div className='flex h-full items-center justify-center bg-sidebar p-4'>
			<div className='flex w-full max-w-md flex-col items-center gap-4 rounded-lg border border-border border-dashed p-8 text-center'>
				<div className='font-medium text-sm'>
					{t('workbench:setup-script.missing.title', 'Add setup script')}
				</div>
				<div className='flex items-center gap-2'>
					<Button onClick={onAskAgent} size='sm'>
						{t('workbench:setup-script.ask-agent', 'Ask agent')}
					</Button>
					<Button onClick={onAddManually} size='sm' variant='outline'>
						{t('workbench:setup-script.add-manually', 'Add manually')}
					</Button>
				</div>
				<p className='max-w-xs text-muted-foreground text-xs leading-5'>
					{t(
						'workbench:setup-script.missing.message',
						'Run commands when a workspace is created to install dependencies or set up the environment',
					)}
				</p>
			</div>
		</div>
	);
}
