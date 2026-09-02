import { ArchiveIcon, ArchiveRestoreIcon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { ArchiveDiagnosticsList } from '@/renderer/components/workbench-shell/archive-diagnostics-list';
import { canRestoreArchivedWorkspace } from '@/renderer/lib/archive-restore';
import type {
	ArchivedWorkspaceListEntry,
	DeleteArchivedWorkspaceDiagnostic,
	UnarchiveWorkspaceDiagnostic,
} from '@/shared/ipc/contracts/workspace';

/** Diagnostic surfaced against a single archived-workspace row. */
export type ArchiveRowDiagnostic =
	| DeleteArchivedWorkspaceDiagnostic
	| UnarchiveWorkspaceDiagnostic;

/** Which per-row action is in flight, or null when the row is idle. */
export type ArchiveRowAction = 'delete' | 'unarchive';

/** One archived workspace, with its restore and purge actions. */
export function BrowseArchiveRow({
	diagnostics,
	disabled,
	entry,
	onDelete,
	onUnarchive,
	pendingAction,
}: {
	diagnostics: ArchiveRowDiagnostic[];
	/**
	 * Whether anything is running in the dialog, not just on this row: every
	 * action here drives git against one repository, so one in flight locks all
	 * of them.
	 */
	disabled: boolean;
	entry: ArchivedWorkspaceListEntry;
	onDelete: (entry: ArchivedWorkspaceListEntry) => void;
	onUnarchive: (entry: ArchivedWorkspaceListEntry) => void;
	/** The action running on this row, or null when nothing is. */
	pendingAction: ArchiveRowAction | null;
}) {
	const { t } = useTranslation();
	const isBusy = disabled || pendingAction !== null;

	return (
		<li
			className='flex flex-col gap-2 px-4 py-3'
			data-testid='browse-archive-row'
		>
			<div className='flex flex-col gap-0.5'>
				<span className='flex items-center gap-1.5 font-medium text-[0.8125rem]'>
					<ArchiveIcon
						aria-hidden='true'
						className='size-3.5 text-muted-foreground'
					/>
					{entry.name}
				</span>
				<span className='font-mono text-[0.6875rem] text-muted-foreground'>
					{entry.branchName ??
						t('workbench:browse-archive.row.no-branch', 'no branch')}
				</span>
				<span className='truncate font-mono text-[0.6875rem] text-muted-foreground'>
					{entry.path}
				</span>
				<span className='text-[0.6875rem] text-muted-foreground'>
					<ArchiveRowStatus entry={entry} />
				</span>
			</div>
			<div className='flex gap-2'>
				<Button
					className='h-8'
					disabled={isBusy || !canRestoreArchivedWorkspace(entry)}
					onClick={() => {
						onUnarchive(entry);
					}}
					pending={pendingAction === 'unarchive'}
					size='sm'
					type='button'
					variant='default'
				>
					<ArchiveRestoreIcon aria-hidden='true' data-icon='inline-start' />
					{t('common:actions.unarchive', 'Unarchive')}
				</Button>
				<Button
					className='h-8'
					disabled={isBusy}
					onClick={() => {
						onDelete(entry);
					}}
					pending={pendingAction === 'delete'}
					size='sm'
					type='button'
					variant='destructive'
				>
					<Trash2Icon aria-hidden='true' data-icon='inline-start' />
					{t(
						'workbench:browse-archive.row.delete-permanently',
						'Delete permanently',
					)}
				</Button>
			</div>
			{diagnostics.length > 0 ? (
				<ArchiveDiagnosticsList
					diagnostics={diagnostics}
					testId={`browse-archive-row-diagnostics-${entry.id}`}
				/>
			) : null}
		</li>
	);
}

/**
 * The one line that tells the user what restoring this row will actually give
 * them back, which differs by how the archive disposed of the worktree.
 */
function ArchiveRowStatus({ entry }: { entry: ArchivedWorkspaceListEntry }) {
	const { t } = useTranslation();
	const date = formatArchivedAt(entry.archivedAt);

	if (entry.branchCleanup) {
		return t(
			'workbench:browse-archive.row.archived-destroyed',
			'Archived {{date}} · worktree was destroyed (recreate from base branch on restore)',
			{ date },
		);
	}

	if (entry.worktreePruned) {
		return t(
			'workbench:browse-archive.row.archived-pruned',
			'Archived {{date}} · disk reclaimed (restored from its branch on unarchive)',
			{ date },
		);
	}

	return t('workbench:browse-archive.row.archived', 'Archived {{date}}', {
		date,
	});
}

/**
 * Format an archived-at ISO timestamp as a locale string, falling back to the raw value.
 * @param iso - ISO timestamp string
 * @returns The localized date-time, or the original string when parsing fails.
 */
function formatArchivedAt(iso: string): string {
	try {
		return new Date(iso).toLocaleString();
	} catch {
		return iso;
	}
}
