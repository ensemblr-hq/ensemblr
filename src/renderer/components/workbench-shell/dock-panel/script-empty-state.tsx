import { SquareTerminalIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';

/** Generic dock empty state with title, body and primary action. */
export function ScriptEmptyState({
	actionLabel,
	detail,
	onAction,
	title,
}: {
	actionLabel: string;
	detail: string;
	onAction: () => void;
	title: string;
}) {
	return (
		<div className='flex h-full items-center justify-center bg-terminal p-4 text-terminal-foreground'>
			<div className='flex max-w-72 flex-col items-center gap-2 text-center'>
				<div className='grid size-8 place-items-center rounded-md border border-terminal-border bg-terminal-muted/10'>
					<SquareTerminalIcon aria-hidden='true' className='size-4' />
				</div>
				<div className='font-medium text-xs'>{title}</div>
				<p className='text-terminal-muted text-xs leading-5'>{detail}</p>
				<Button className='mt-1' onClick={onAction} size='xs' variant='outline'>
					{actionLabel}
				</Button>
			</div>
		</div>
	);
}
