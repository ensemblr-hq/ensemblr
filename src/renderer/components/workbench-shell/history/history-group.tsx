import type { WorkspaceHistoryEntry } from '@/shared/ipc/contracts/workspace';

import { HistoryRow } from './history-row';

/** One relative-time bucket: a sticky header (label + count) and its rows. */
export function HistoryGroup({
	entries,
	label,
	onOpen,
}: {
	entries: WorkspaceHistoryEntry[];
	label: string;
	onOpen: (entry: WorkspaceHistoryEntry) => void;
}) {
	return (
		<section className='flex flex-col gap-1'>
			<h2 className='sticky top-0 z-10 flex items-baseline gap-2 bg-background/95 px-2 py-1 font-medium text-muted-foreground text-xs backdrop-blur'>
				{label}
				<span className='text-muted-foreground/50'>{entries.length}</span>
			</h2>
			<ul className='flex flex-col gap-0.5'>
				{entries.map((entry) => (
					<HistoryRow entry={entry} key={entry.id} onOpen={onOpen} />
				))}
			</ul>
		</section>
	);
}
