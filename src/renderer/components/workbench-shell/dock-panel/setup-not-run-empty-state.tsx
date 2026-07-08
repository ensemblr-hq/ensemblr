import { PlayIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';

/**
 * Empty state for the Setup dock tab when a setup script is configured but has
 * not run yet: a caption plus a "Run setup" action that streams the script's
 * output into this panel once started.
 */
export function SetupNotRunEmptyState({
	onRunSetupScript,
}: {
	onRunSetupScript: () => void;
}) {
	return (
		<div className='flex h-full items-center justify-center bg-terminal p-4 text-terminal-foreground'>
			<div className='flex flex-col items-center gap-2 text-center'>
				<div className='font-medium text-sm'>No setup script output</div>
				<p className='text-terminal-muted text-xs leading-5'>
					Setup script output will appear here after running setup.
				</p>
				<Button
					className='mt-1 gap-2'
					onClick={onRunSetupScript}
					size='sm'
					variant='outline'
				>
					<PlayIcon aria-hidden='true' />
					Run setup
				</Button>
			</div>
		</div>
	);
}
