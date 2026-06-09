import { SparklesIcon } from 'lucide-react';

import type { ClosedChatTabEntryWire } from '@/shared/ipc';

/**
 * Empty-state shown above the composer when a workspace has prior chats /
 * transcripts in `.context/` but no active Pi session in the current tab.
 * Lists each transcript as a chip the user can attach to the new chat.
 */
export function NewChatEmptyState({
	transcripts,
	workspaceName,
}: {
	transcripts: readonly ClosedChatTabEntryWire[];
	workspaceName: string;
}) {
	return (
		<section
			aria-label='New chat empty state'
			className='flex flex-col items-start gap-4 text-sm'
			data-new-chat-state='empty'
		>
			<p className='text-muted-foreground'>
				New chat in <span className='font-mono'>/{workspaceName}</span>.
			</p>

			{transcripts.length > 0 ? (
				<div className='flex flex-col items-start gap-2'>
					<p className='text-muted-foreground text-xs'>Add chat transcripts:</p>
					<ul className='flex flex-wrap gap-2'>
						{transcripts.map((entry) => (
							<li key={entry.tab.id}>
								<TranscriptChip entry={entry} />
							</li>
						))}
					</ul>
				</div>
			) : null}
		</section>
	);
}

function TranscriptChip({ entry }: { entry: ClosedChatTabEntryWire }) {
	const label = entry.summaryTitle ?? entry.tab.title ?? 'Untitled transcript';

	return (
		<button
			className='inline-flex items-center gap-1.5 rounded-md border border-border bg-pane px-2.5 py-1 text-foreground text-xs transition-colors hover:border-foreground/30 hover:bg-muted/40'
			data-transcript-id={entry.tab.id}
			title={entry.summaryPath}
			type='button'
		>
			<SparklesIcon aria-hidden='true' className='size-3.5 text-muted-foreground' />
			<span className='truncate'>{label}</span>
		</button>
	);
}
