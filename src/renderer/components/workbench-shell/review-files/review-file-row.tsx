import { Icon } from '@iconify/react';
import {
	CheckIcon,
	ChevronDownIcon,
	DotSquareIcon,
	MinusSquareIcon,
	PlusSquareIcon,
	Undo2Icon,
} from 'lucide-react';
import { useState } from 'react';

import { FilePathLabel } from '@/renderer/components/file-path-label';
import { Button } from '@/renderer/components/ui/button';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { OpenInFileMenu } from '@/renderer/components/workbench-shell/open-in-file-menu';
import { cn } from '@/renderer/lib/utils';
import {
	fileTreeIndentClassName,
	getWorkspaceFileIconName,
} from '@/renderer/lib/workbench';
import type { ReviewFileSummary } from '@/renderer/types/workbench';

import { useReviewFileActions } from './review-file-actions-context';

const fileStatusLabel: Record<ReviewFileSummary['status'], string> = {
	added: 'A',
	deleted: 'D',
	modified: 'M',
	renamed: 'R',
	untracked: 'U',
};

/**
 * Single changed-file row. Click opens the file — its diff, or the image preview
 * when the workspace still holds a previewable image. On hover — or while its
 * open-in menu is open — the trailing +/- stats swap for a Discard button and an
 * "Open in" dropdown. A row marked viewed in the diff toolbar dims until the file
 * changes again.
 */
export function ReviewFileRow({
	ariaLevel,
	file,
	level = 0,
	showPath,
}: {
	/** Tree depth (1-based) when rendered inside the folder tree; omit in the flat list. */
	ariaLevel?: number;
	file: ReviewFileSummary;
	level?: number;
	showPath: boolean;
}) {
	const {
		copyTarget,
		invokeTarget,
		isDiscardable,
		isViewed,
		onDiscardFile,
		openFile,
		openInTargets,
	} = useReviewFileActions();
	const [isMenuOpen, setIsMenuOpen] = useState(false);

	const fileName = getReviewFileName(file.path);
	const hasOpenInMenu = openInTargets.length > 0 || Boolean(copyTarget);
	const canDiscard = isDiscardable(file.path);
	const viewed = isViewed(file);
	const openThisFile = openFile ? () => openFile(file.path) : undefined;
	const keepThisFileOpen = openFile
		? () => openFile(file.path, { preview: false })
		: undefined;

	return (
		<div
			className={cn(
				'group relative flex h-8 w-full items-center rounded-md pr-1.5 hover:bg-muted',
				isMenuOpen && 'bg-muted',
				// Dim the whole row rather than its text so the file icon and status
				// mark recede with it, and lift it back on hover so a reviewer
				// returning to a signed-off file can still read it.
				viewed && 'opacity-50 hover:opacity-100',
				fileTreeIndentClassName(level),
			)}
			data-row-kind='file'
			data-row-path={file.path}
			// `aria-level` is only valid alongside a tree role: apply both together
			// in the folder tree, neither in the flat list.
			{...(ariaLevel === undefined
				? {}
				: { 'aria-level': ariaLevel, role: 'treeitem' as const })}
		>
			<button
				aria-label={`Open ${file.path}`}
				className='flex h-full min-w-0 flex-1 items-center gap-2 self-stretch rounded-md px-2 text-left font-mono text-xs'
				onClick={openThisFile}
				onDoubleClick={keepThisFileOpen}
				type='button'
			>
				<Icon
					aria-hidden='true'
					className='size-3.5 shrink-0'
					icon={getWorkspaceFileIconName({ kind: 'file', name: fileName })}
				/>
				{showPath ? (
					<FilePathLabel path={file.path} />
				) : (
					<span className='min-w-0 truncate'>{fileName}</span>
				)}
			</button>
			<div
				className={cn(
					'items-center gap-1.5 pl-2',
					isMenuOpen ? 'hidden' : 'flex group-hover:hidden',
				)}
			>
				{viewed ? (
					<CheckIcon
						aria-label='Viewed'
						className='size-3.5 shrink-0 text-muted-foreground'
						role='img'
					/>
				) : null}
				<ReviewFileStats file={file} />
				<ReviewFileStatusMark status={file.status} />
			</div>
			<div
				className={cn(
					'items-center gap-0.5 pl-2',
					isMenuOpen ? 'flex' : 'hidden group-hover:flex',
				)}
			>
				{canDiscard ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								aria-label={`Discard changes to ${file.path}`}
								className='text-muted-foreground hover:text-foreground'
								onClick={() => onDiscardFile(file.path)}
								size='icon-xs'
								variant='ghost'
							>
								<Undo2Icon />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Discard changes</TooltipContent>
					</Tooltip>
				) : null}
				{hasOpenInMenu ? (
					<OpenInFileMenu
						copyTarget={copyTarget}
						filePath={file.path}
						invokeTarget={invokeTarget}
						onOpenChange={setIsMenuOpen}
						openInTargets={openInTargets}
					>
						<Button
							aria-label={`Open ${file.path} in…`}
							className='text-muted-foreground hover:text-foreground'
							size='icon-xs'
							variant='ghost'
						>
							<ChevronDownIcon />
						</Button>
					</OpenInFileMenu>
				) : null}
			</div>
		</div>
	);
}

/** Trailing status badge and +/- diff numbers for a file row. */
function ReviewFileStats({ file }: { file: ReviewFileSummary }) {
	const statusLabel =
		file.status === 'modified' ? null : fileStatusLabel[file.status];

	return (
		<div className='flex min-w-0 max-w-28 shrink-0 items-center justify-end gap-1 font-mono text-xxs tabular-nums'>
			{statusLabel ? (
				<span className='truncate text-muted-foreground'>{statusLabel}</span>
			) : null}
			{file.additions > 0 ? (
				<span className='shrink-0 text-status-ok'>+{file.additions}</span>
			) : null}
			{file.deletions > 0 ? (
				<span className='shrink-0 text-status-danger'>-{file.deletions}</span>
			) : null}
		</div>
	);
}

/**
 * Trailing status square, mirroring the way Conductor marks rows: a plus for new
 * files, a centered dot for in-place edits, a minus for deletions. Purely a
 * status marker — opening the diff is the row's own click.
 */
const reviewFileStatusMark: Record<
	ReviewFileSummary['status'],
	{ Icon: typeof DotSquareIcon; className: string; label: string }
> = {
	added: {
		Icon: PlusSquareIcon,
		className: 'text-muted-foreground',
		label: 'Added',
	},
	deleted: {
		Icon: MinusSquareIcon,
		className: 'text-status-danger',
		label: 'Deleted',
	},
	modified: {
		Icon: DotSquareIcon,
		className: 'text-status-warning',
		label: 'Modified',
	},
	renamed: {
		Icon: DotSquareIcon,
		className: 'text-status-warning',
		label: 'Renamed',
	},
	untracked: {
		Icon: PlusSquareIcon,
		className: 'text-muted-foreground',
		label: 'Untracked',
	},
};

/** Renders the colored icon marking a review file's git change status. */
function ReviewFileStatusMark({
	status,
}: {
	status: ReviewFileSummary['status'];
}) {
	const { Icon, className, label } = reviewFileStatusMark[status];

	return (
		<Icon
			aria-label={label}
			className={cn('size-3.5 shrink-0', className)}
			role='img'
		/>
	);
}

/** Returns the basename portion of a file path. */
function getReviewFileName(path: string) {
	const lastSeparatorIndex = path.lastIndexOf('/');

	return lastSeparatorIndex === -1 ? path : path.slice(lastSeparatorIndex + 1);
}
