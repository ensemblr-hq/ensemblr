import { useQueryClient } from '@tanstack/react-query';
import {
	ArchiveIcon,
	ArrowRightIcon,
	ChevronRightIcon,
	GitBranchIcon,
} from 'lucide-react';
import { type ReactNode, useCallback, useRef, useState } from 'react';

import {
	invalidateWorkspaceListViews,
	isEnsemblrApiAvailable,
	unarchiveWorkspace,
} from '@/renderer/api/ensemblr';
import { Button } from '@/renderer/components/ui/button';
import { canRestoreArchivedWorkspace } from '@/renderer/lib/archive-restore';
import { cn } from '@/renderer/lib/utils';
import type {
	UnarchiveWorkspaceDiagnostic,
	WorkspaceHistoryEntry,
} from '@/shared/ipc/contracts/workspace';

import { ArchiveDiagnosticsList } from '../archive-diagnostics-list';
import { formatRowDate } from './relative-time';

/** Shared row chrome: full-width hover surface, single baseline, rounded. */
const ROW_CLASS_NAME =
	'group/history-row relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent';

/**
 * A single History row, rendered as one line: `[icon] project › name · branch`
 * on the left and a trailing slot on the right that shows the last-activity date
 * by default and swaps to an action affordance on hover/focus.
 *
 * Active workspaces (`archivedAt === null`) render the whole row as a button
 * that navigates to the workspace, with a `Go to →` hint. Archived workspaces
 * render a muted row whose trailing slot reveals an Unarchive action that
 * restores the sidebar entry, chats, and worktree, then invalidates the History
 * feed + navigation snapshot so both refresh without a reload. Unarchive is
 * disabled when the worktree was destroyed at archive time but the base/branch
 * needed to recreate it is missing — mirroring `BrowseArchiveDialog`.
 */
export function HistoryRow({
	entry,
	onOpen,
}: {
	entry: WorkspaceHistoryEntry;
	onOpen: (entry: WorkspaceHistoryEntry) => void;
}) {
	const queryClient = useQueryClient();
	const apiAvailable = isEnsemblrApiAvailable();
	const [pending, setPending] = useState(false);
	// Ref latch (not the `pending` state) guards re-entry: state updates are
	// async, so a fast double-click could pass a stale `pending === false` check
	// twice before the first re-render. The ref flips synchronously.
	const pendingRef = useRef(false);
	const [diagnostics, setDiagnostics] = useState<
		UnarchiveWorkspaceDiagnostic[]
	>([]);

	const isArchived = entry.archivedAt !== null;
	const restoreBlocked = !canRestoreArchivedWorkspace(entry);

	const handleUnarchive = useCallback(async () => {
		if (!apiAvailable || pendingRef.current) {
			return;
		}
		pendingRef.current = true;
		setPending(true);
		setDiagnostics([]);

		try {
			const result = await unarchiveWorkspace({ workspaceId: entry.id });

			if (result.status === 'success') {
				await invalidateWorkspaceListViews(queryClient);
				return;
			}

			setDiagnostics(result.diagnostics);
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	}, [apiAvailable, entry.id, queryClient]);

	return (
		<li className='flex flex-col gap-1' data-testid='history-row'>
			{isArchived ? (
				<div className={ROW_CLASS_NAME}>
					<RowLabel archived entry={entry} />
					<RowTrailing date={formatRowDate(entry.updatedAt)}>
						<Button
							disabled={pending || restoreBlocked || !apiAvailable}
							onClick={() => {
								void handleUnarchive();
							}}
							size='xs'
							title={
								restoreBlocked
									? 'Cannot restore: the recorded base branch or branch name is missing.'
									: undefined
							}
							type='button'
							variant='subtle'
						>
							{pending ? 'Restoring…' : 'Unarchive'}
						</Button>
					</RowTrailing>
				</div>
			) : (
				<button
					className={cn(ROW_CLASS_NAME, 'cursor-pointer')}
					onClick={() => {
						onOpen(entry);
					}}
					type='button'
				>
					<RowLabel entry={entry} />
					<RowTrailing date={formatRowDate(entry.updatedAt)}>
						<span className='flex items-center gap-1 whitespace-nowrap font-medium text-muted-foreground text-xs'>
							Go to
							<ArrowRightIcon aria-hidden='true' className='size-3' />
						</span>
					</RowTrailing>
				</button>
			)}

			{diagnostics.length > 0 ? (
				<ArchiveDiagnosticsList
					diagnostics={diagnostics}
					testId={`history-row-diagnostics-${entry.id}`}
				/>
			) : null}
		</li>
	);
}

/**
 * Left region of a row: state icon, then `project › name · branch` on one line.
 * Archived rows are fully muted; active rows lift the project + name to the
 * foreground so the still-open workspace reads as the emphasized entry.
 */
function RowLabel({
	archived,
	entry,
}: {
	archived?: boolean;
	entry: WorkspaceHistoryEntry;
}) {
	const Icon = archived ? ArchiveIcon : GitBranchIcon;
	return (
		<div className='flex min-w-0 flex-1 items-center gap-2'>
			<Icon
				aria-hidden='true'
				className={cn(
					'size-3.5 shrink-0',
					archived ? 'text-muted-foreground' : 'text-foreground',
				)}
			/>
			<span
				className={cn(
					'shrink-0 text-[0.8125rem]',
					archived ? 'text-muted-foreground' : 'font-medium text-foreground',
				)}
			>
				{entry.repositoryName}
			</span>
			<ChevronRightIcon
				aria-hidden='true'
				className='size-3 shrink-0 text-muted-foreground/40'
			/>
			<span
				className={cn(
					'min-w-0 truncate text-[0.8125rem]',
					archived ? 'text-muted-foreground' : 'font-medium text-foreground',
				)}
			>
				{entry.name}
			</span>
			{entry.branchName ? (
				<>
					<span className='shrink-0 text-muted-foreground/40'>·</span>
					<span className='min-w-0 shrink truncate text-muted-foreground text-xs'>
						{entry.branchName}
					</span>
				</>
			) : null}
		</div>
	);
}

/**
 * Right region of a row. The date sits in the layout flow (defining the slot
 * width); the action overlays it, hidden until the row is hovered or holds
 * focus. `pointer-events-none` keeps the concealed action from intercepting
 * clicks meant for the row.
 */
function RowTrailing({
	children,
	date,
}: {
	children: ReactNode;
	date: string;
}) {
	return (
		<div className='grid shrink-0 items-center justify-items-end'>
			<span className='col-start-1 row-start-1 whitespace-nowrap text-muted-foreground text-xs tabular-nums transition-opacity group-focus-within/history-row:opacity-0 group-hover/history-row:opacity-0'>
				{date}
			</span>
			<div className='pointer-events-none col-start-1 row-start-1 flex items-center whitespace-nowrap opacity-0 transition-opacity group-focus-within/history-row:pointer-events-auto group-focus-within/history-row:opacity-100 group-hover/history-row:pointer-events-auto group-hover/history-row:opacity-100'>
				{children}
			</div>
		</div>
	);
}
