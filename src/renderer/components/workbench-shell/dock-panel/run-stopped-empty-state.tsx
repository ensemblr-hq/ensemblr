import { PlayIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import { formatShortcut } from '@/shared/keymap';

/**
 * Empty state for the Run dock tab when a run script is configured but stopped:
 * a large play glyph, a primary "Start Run" action carrying the ⌘R hint, and a
 * caption pointing at where dev-server output will stream once it starts.
 */
export function RunStoppedEmptyState({
	onRunScript,
}: {
	onRunScript: () => void;
}) {
	return (
		<div className='flex h-full items-center justify-center bg-terminal p-4 text-terminal-foreground'>
			<div className='flex flex-col items-center gap-5 text-center'>
				<PlayIcon
					aria-hidden='true'
					className='size-12 fill-current text-terminal-muted'
					strokeWidth={0}
				/>
				<div className='flex flex-col items-center gap-2'>
					<Button
						className='gap-2'
						onClick={onRunScript}
						size='sm'
						variant='outline'
					>
						Start Run
						<span className='text-terminal-muted'>
							{formatShortcut('run.start')}
						</span>
					</Button>
					<p className='text-terminal-muted text-xs'>Test your changes here.</p>
				</div>
			</div>
		</div>
	);
}
