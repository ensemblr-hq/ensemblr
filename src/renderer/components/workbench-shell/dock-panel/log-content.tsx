import { SquareTerminalIcon } from 'lucide-react';

import { ScrollArea } from '@/renderer/components/ui/scroll-area';

/** Terminal-style scroll area that renders one numbered line per entry. */
export function LogDockContent({
	isReadOnly = false,
	lines,
	sessionId,
	title,
}: {
	isReadOnly?: boolean;
	lines: string[];
	sessionId?: string;
	title: string;
}) {
	return (
		<ScrollArea
			className='h-full bg-terminal text-terminal-foreground'
			data-terminal-session-id={sessionId}
			data-terminal-surface={
				isReadOnly ? 'readonly-script-output' : 'interactive'
			}
		>
			<div className='flex flex-col gap-1.5 p-3 font-mono text-xs leading-5'>
				<div className='mb-1 flex items-center gap-2 text-terminal-muted'>
					<SquareTerminalIcon aria-hidden='true' className='size-3.5' />
					<span>{title}</span>
				</div>
				{lines.map((line, index) => (
					<div className='flex gap-3' key={`${line}-${index}`}>
						<span className='select-none text-terminal-muted'>
							{String(index + 1).padStart(2, '0')}
						</span>
						<code>{line}</code>
					</div>
				))}
			</div>
		</ScrollArea>
	);
}
