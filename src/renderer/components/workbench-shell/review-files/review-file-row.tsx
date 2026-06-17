import { Icon } from '@iconify/react';
import {
	ChevronDownIcon,
	CopyIcon,
	DotSquareIcon,
	MinusSquareIcon,
	PlusSquareIcon,
	Undo2Icon,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { OpenTargetIcon } from '@/renderer/components/workbench-shell/open-target-icon';
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
 * Single changed-file row. Click (or the trailing open-diff icon) opens the
 * working-tree diff. On hover — or while its open-in menu is open — the trailing
 * +/- stats swap for a Discard button and an "Open in" dropdown.
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
	const { copyTarget, invokeTarget, onDiscardFile, openDiff, openInTargets } =
		useReviewFileActions();
	const [isMenuOpen, setIsMenuOpen] = useState(false);

	const fileName = getReviewFileName(file.path);
	const hasOpenInMenu = openInTargets.length > 0 || Boolean(copyTarget);
	const openThisDiff = openDiff ? () => openDiff(file.path) : undefined;

	return (
		<div
			className={cn(
				'group relative flex h-8 w-full items-center rounded-md pr-1.5 hover:bg-muted',
				isMenuOpen && 'bg-muted',
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
				aria-label={`Open ${file.path} diff`}
				className='flex h-full min-w-0 flex-1 items-center gap-2 self-stretch rounded-md px-2 text-left font-mono text-xs'
				onClick={openThisDiff}
				type='button'
			>
				<Icon
					aria-hidden='true'
					className='size-3.5 shrink-0'
					icon={getWorkspaceFileIconName({ kind: 'file', name: fileName })}
				/>
				{showPath ? (
					<ReviewFilePath path={file.path} />
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
				<ReviewFileStats file={file} />
				<ReviewFileStatusMark status={file.status} />
			</div>
			<div
				className={cn(
					'items-center gap-0.5 pl-2',
					isMenuOpen ? 'flex' : 'hidden group-hover:flex',
				)}
			>
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
				{hasOpenInMenu ? (
					<ReviewFileOpenInMenu
						copyTarget={copyTarget}
						filePath={file.path}
						invokeTarget={invokeTarget}
						onOpenChange={setIsMenuOpen}
						openInTargets={openInTargets}
					/>
				) : null}
			</div>
		</div>
	);
}

/** Trailing "Open in <app>" dropdown shown on row hover. */
function ReviewFileOpenInMenu({
	copyTarget,
	filePath,
	invokeTarget,
	onOpenChange,
	openInTargets,
}: {
	copyTarget: ReturnType<typeof useReviewFileActions>['copyTarget'];
	filePath: string;
	invokeTarget: ReturnType<typeof useReviewFileActions>['invokeTarget'];
	onOpenChange: (open: boolean) => void;
	openInTargets: ReturnType<typeof useReviewFileActions>['openInTargets'];
}) {
	const invoke = (target: Parameters<typeof invokeTarget>[0]) =>
		void invokeTarget(target, {
			relativePath: filePath,
			relativePathKind: 'file',
		});

	return (
		<DropdownMenu onOpenChange={onOpenChange}>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label={`Open ${filePath} in…`}
					className='text-muted-foreground hover:text-foreground'
					size='icon-xs'
					variant='ghost'
				>
					<ChevronDownIcon />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-56 bg-muted p-1'>
				{openInTargets.map((openTarget) => (
					<DropdownMenuItem
						className='h-8 gap-2.5 px-2 text-[0.8125rem]'
						key={openTarget.id}
						onSelect={() => invoke(openTarget)}
					>
						<OpenTargetIcon className='size-4' target={openTarget} />
						<span className='min-w-0 flex-1 truncate'>{openTarget.label}</span>
						<span className='w-3.5 shrink-0 text-right text-muted-foreground text-xs tabular-nums'>
							{openTarget.numberShortcutLabel}
						</span>
					</DropdownMenuItem>
				))}
				{copyTarget ? (
					<>
						{openInTargets.length ? (
							<DropdownMenuSeparator className='my-1' />
						) : null}
						<DropdownMenuItem
							className='h-8 gap-2.5 px-2 text-[0.8125rem]'
							onSelect={() => invoke(copyTarget)}
						>
							<CopyIcon
								aria-hidden='true'
								className='size-4 text-muted-foreground'
							/>
							<span className='min-w-0 flex-1'>Copy path</span>
						</DropdownMenuItem>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Renders a file path with a dimmed directory prefix. When the row is too narrow
 * the directory truncates (ellipsis) while the file name stays fully visible —
 * the name is what identifies the change, so it never gets clipped first.
 */
function ReviewFilePath({ path }: { path: string }) {
	const directory = getReviewFileDirectory(path);
	const fileName = getReviewFileName(path);

	return (
		<span className='flex min-w-0 items-center overflow-hidden'>
			{directory ? (
				<span className='min-w-0 truncate text-muted-foreground'>
					{directory}/
				</span>
			) : null}
			<span className='shrink-0'>{fileName}</span>
		</span>
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

/** Returns the parent-directory portion of a file path, or `''` when none. */
function getReviewFileDirectory(path: string) {
	const lastSeparatorIndex = path.lastIndexOf('/');

	return lastSeparatorIndex === -1 ? '' : path.slice(0, lastSeparatorIndex);
}

/** Returns the basename portion of a file path. */
export function getReviewFileName(path: string) {
	const lastSeparatorIndex = path.lastIndexOf('/');

	return lastSeparatorIndex === -1 ? path : path.slice(lastSeparatorIndex + 1);
}
