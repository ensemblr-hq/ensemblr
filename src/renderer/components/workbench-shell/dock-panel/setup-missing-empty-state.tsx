import { Button } from '@/renderer/components/ui/button';

/**
 * Empty state for the Setup dock tab when no setup script is configured: an
 * "Ask agent" action that seeds the composer with a settings.toml setup prompt,
 * and an "Add manually" action that opens the repository's Scripts settings.
 */
export function SetupMissingEmptyState({
	onAddManually,
	onAskAgent,
}: {
	onAddManually: () => void;
	onAskAgent: () => void;
}) {
	return (
		<div className='flex h-full items-center justify-center bg-terminal p-4 text-terminal-foreground'>
			<div className='flex w-full max-w-md flex-col items-center gap-4 rounded-lg border border-terminal-border border-dashed p-8 text-center'>
				<div className='font-medium text-sm'>Add setup script</div>
				<div className='flex items-center gap-2'>
					<Button onClick={onAskAgent} size='sm'>
						Ask agent
					</Button>
					<Button onClick={onAddManually} size='sm' variant='secondary'>
						Add manually
					</Button>
				</div>
				<p className='max-w-xs text-terminal-muted text-xs leading-5'>
					Run commands when a workspace is created to install dependencies or
					set up the environment
				</p>
			</div>
		</div>
	);
}
