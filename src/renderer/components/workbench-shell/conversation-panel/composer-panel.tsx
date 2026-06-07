import { FileCodeIcon } from 'lucide-react';

import { StatusBadge } from '@/renderer/components/status-badge';
import { Button } from '@/renderer/components/ui/button';
import { Textarea } from '@/renderer/components/ui/textarea';
import type { ComposerShellState } from '@/renderer/types/workbench';

/** Sticky bottom composer with textarea, status badges and send/attach. */
export function ComposerPanel({ composer }: { composer: ComposerShellState }) {
	return (
		<footer className='shrink-0 border-border border-t bg-background p-3'>
			<div className='rounded-md border border-border bg-pane p-2'>
				<Textarea
					aria-label='Pi composer'
					className='min-h-24 resize-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-0'
					disabled={composer.disabled}
					placeholder={composer.placeholder}
				/>
				<div className='mt-2 flex flex-wrap items-center justify-between gap-2'>
					<div className='flex flex-wrap items-center gap-1.5'>
						<StatusBadge tone='muted'>{composer.modelLabel}</StatusBadge>
						<StatusBadge tone='muted'>{composer.thinkingLabel}</StatusBadge>
						{composer.disabledReason ? (
							<StatusBadge
								className='min-w-0 max-w-full truncate'
								tone='warning'
							>
								{composer.disabledReason}
							</StatusBadge>
						) : null}
					</div>
					<div className='flex items-center gap-1.5'>
						<Button disabled={composer.disabled} size='sm' variant='outline'>
							<FileCodeIcon data-icon='inline-start' />
							Attach
						</Button>
						<Button disabled={composer.disabled} size='sm'>
							Send
						</Button>
					</div>
				</div>
			</div>
		</footer>
	);
}
