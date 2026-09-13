import { Icon } from '@iconify/react';
import {
	CheckIcon,
	ChevronDownIcon,
	DotSquareIcon,
	MinusSquareIcon,
	PlusSquareIcon,
	TriangleAlertIcon,
	Undo2Icon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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
	isPreviewableWorkspaceFile,
} from '@/renderer/lib/workbench';
import type { ReviewFileSummary } from '@/renderer/types/workbench';

import { useReviewFileActions } from './review-file-actions-context';

const fileStatusLabel: Record<ReviewFileSummary['status'], string> = {
	added: 'A',
	conflicted: 'U',
	deleted: 'D',
	modified: 'M',
	renamed: 'R',
	untracked: 'U',
};

/**
 * Single changed-file row: the path and the click that opens it, then a trailing
 * cluster that swaps the +/- stats for Discard and "Open in" on hover. A row
 * marked viewed in the diff toolbar dims until the file changes again, and a row
 * whose discard is still running dims and stops responding until git answers.
 *
 * Owns only the hover/viewed/discarding state the three clusters share; each
 * reads the actions it needs from the row-actions context itself.
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
	const { isDiscarding, isViewed } = useReviewFileActions();
	const [isMenuOpen, setIsMenuOpen] = useState(false);

	const discarding = isDiscarding(file.path);
	const viewed = isViewed(file);

	return (
		<div
			className={cn(
				'group relative flex h-8 w-full items-center rounded-md pr-1.5 hover:bg-muted',
				isMenuOpen && 'bg-muted',
				// Dim the whole row rather than its text so the file icon and status
				// mark recede with it, and lift it back on hover so a reviewer
				// returning to a signed-off file can still read it.
				viewed && 'opacity-50 hover:opacity-100',
				// `pointer-events-none` covers the pointer, and stops the viewed lift
				// above from firing besides, since a row that is not a hit-test target
				// never matches `:hover`. It leaves the tab order untouched, so each
				// control carries `disabled` for the keyboard as well.
				discarding && 'pointer-events-none opacity-50',
				fileTreeIndentClassName(level),
			)}
			aria-busy={discarding || undefined}
			data-row-kind='file'
			data-row-path={file.path}
			// `aria-level` is only valid alongside a tree role: apply both together
			// in the folder tree, neither in the flat list.
			{...(ariaLevel === undefined
				? {}
				: { 'aria-level': ariaLevel, role: 'treeitem' as const })}
		>
			<ReviewFileOpenButton
				discarding={discarding}
				file={file}
				showPath={showPath}
			/>
			<ReviewFileRowSummary
				file={file}
				isMenuOpen={isMenuOpen}
				viewed={viewed}
			/>
			<ReviewFileRowActions
				discarding={discarding}
				file={file}
				isMenuOpen={isMenuOpen}
				onMenuOpenChange={setIsMenuOpen}
			/>
		</div>
	);
}

/**
 * The row's leading control: the file icon — the shortcut glyph when the path is
 * a symlink, exactly as the files tree badges it — its name or path, and the
 * click that opens the file: its diff, or the image preview when the workspace
 * still holds a previewable image.
 *
 * A symlink to a directory is the one row that opens nothing, matching the files
 * tree: neither the diff nor the preview describes what the reviewer clicked. It
 * stays focusable and says so through `aria-disabled` rather than dropping out of
 * the tab order, because the row's other controls remain live.
 */
function ReviewFileOpenButton({
	discarding,
	file,
	showPath,
}: {
	discarding: boolean;
	file: ReviewFileSummary;
	showPath: boolean;
}) {
	const { openFile } = useReviewFileActions();
	const { t } = useTranslation();

	const fileName = getReviewFileName(file.path);
	const canOpen = isPreviewableWorkspaceFile(file);
	const open = canOpen ? openFile : null;

	return (
		<button
			aria-disabled={!canOpen}
			aria-label={
				canOpen
					? t('review:file-row.open', 'Open {{path}}', { path: file.path })
					: t(
							'review:file-row.symlinked-directory',
							'{{path}} links to a directory and cannot be opened',
							{ path: file.path },
						)
			}
			className={cn(
				'flex h-full min-w-0 flex-1 items-center gap-2 self-stretch rounded-md px-2 text-left font-mono text-xs',
				!canOpen && 'cursor-default',
			)}
			disabled={discarding}
			onClick={open ? () => open(file.path) : undefined}
			onDoubleClick={
				open ? () => open(file.path, { preview: false }) : undefined
			}
			type='button'
		>
			<Icon
				aria-hidden='true'
				className='size-3.5 shrink-0'
				icon={getWorkspaceFileIconName({
					kind: 'file',
					name: fileName,
					symlinkTargetKind: file.symlinkTargetKind,
				})}
			/>
			{showPath ? (
				<FilePathLabel path={file.path} />
			) : (
				<span className='min-w-0 truncate'>{fileName}</span>
			)}
		</button>
	);
}

/**
 * The row's resting trailing cluster: the viewed tick, the +/- counts, and the
 * status mark. Hidden on hover so the action buttons can take the same space.
 */
function ReviewFileRowSummary({
	file,
	isMenuOpen,
	viewed,
}: {
	file: ReviewFileSummary;
	isMenuOpen: boolean;
	viewed: boolean;
}) {
	const { t } = useTranslation();

	return (
		<div
			className={cn(
				'items-center gap-1.5 pl-2',
				isMenuOpen ? 'hidden' : 'flex group-hover:hidden',
			)}
		>
			{viewed ? (
				<CheckIcon
					aria-label={t('review:file-row.viewed', 'Viewed')}
					className='size-3.5 shrink-0 text-muted-foreground'
					role='img'
				/>
			) : null}
			<ReviewFileStats file={file} />
			<ReviewFileStatusMark status={file.status} />
		</div>
	);
}

/**
 * The row's hover cluster, taking the summary's place: Discard for an
 * uncommitted change, and the "Open in" dropdown. Stays visible while that
 * dropdown is open so the pointer can travel into it.
 */
function ReviewFileRowActions({
	discarding,
	file,
	isMenuOpen,
	onMenuOpenChange,
}: {
	discarding: boolean;
	file: ReviewFileSummary;
	isMenuOpen: boolean;
	onMenuOpenChange: (open: boolean) => void;
}) {
	const {
		copyTarget,
		invokeTarget,
		isDiscardable,
		onDiscardFile,
		openInTargets,
	} = useReviewFileActions();
	const { t } = useTranslation();

	const hasOpenInMenu = openInTargets.length > 0 || Boolean(copyTarget);

	return (
		<div
			className={cn(
				'items-center gap-0.5 pl-2',
				isMenuOpen ? 'flex' : 'hidden group-hover:flex',
			)}
		>
			{isDiscardable(file.path) ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							aria-label={t(
								'review:file-row.discard',
								'Discard changes to {{path}}',
								{ path: file.path },
							)}
							className='text-muted-foreground hover:text-foreground'
							disabled={discarding}
							onClick={() => onDiscardFile(file.path)}
							size='icon-xs'
							variant='ghost'
						>
							<Undo2Icon />
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						{t('common:actions.discard-changes', 'Discard changes')}
					</TooltipContent>
				</Tooltip>
			) : null}
			{hasOpenInMenu ? (
				<OpenInFileMenu
					copyTarget={copyTarget}
					filePath={file.path}
					invokeTarget={invokeTarget}
					onOpenChange={onMenuOpenChange}
					openInTargets={openInTargets}
				>
					<Button
						aria-label={t('review:file-row.open-in', 'Open {{path}} in…', {
							path: file.path,
						})}
						className='text-muted-foreground hover:text-foreground'
						disabled={discarding}
						size='icon-xs'
						variant='ghost'
					>
						<ChevronDownIcon />
					</Button>
				</OpenInFileMenu>
			) : null}
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
				<span className='shrink-0 text-diff-addition-foreground'>
					+{file.additions}
				</span>
			) : null}
			{file.deletions > 0 ? (
				<span className='shrink-0 text-diff-deletion-foreground'>
					-{file.deletions}
				</span>
			) : null}
		</div>
	);
}

/**
 * Trailing status square marking how a file changed: a plus for new files, a
 * centered dot for in-place edits, a minus for deletions, and a warning
 * triangle for a file git could not merge. Purely a status marker — opening the
 * diff is the row's own click.
 */
const reviewFileStatusMark: Record<
	ReviewFileSummary['status'],
	{ Icon: typeof DotSquareIcon; className: string }
> = {
	added: { Icon: PlusSquareIcon, className: 'text-muted-foreground' },
	conflicted: { Icon: TriangleAlertIcon, className: 'text-status-danger' },
	deleted: { Icon: MinusSquareIcon, className: 'text-status-danger' },
	modified: { Icon: DotSquareIcon, className: 'text-status-warning' },
	renamed: { Icon: DotSquareIcon, className: 'text-status-warning' },
	untracked: { Icon: PlusSquareIcon, className: 'text-muted-foreground' },
};

/** Renders the colored icon marking a review file's git change status. */
function ReviewFileStatusMark({
	status,
}: {
	status: ReviewFileSummary['status'];
}) {
	const { t } = useTranslation();
	const { Icon, className } = reviewFileStatusMark[status];
	const label: Record<ReviewFileSummary['status'], string> = {
		added: t('review:file-status.added', 'Added'),
		conflicted: t('review:file-status.conflicted', 'Conflicted'),
		deleted: t('review:file-status.deleted', 'Deleted'),
		modified: t('review:file-status.modified', 'Modified'),
		renamed: t('review:file-status.renamed', 'Renamed'),
		untracked: t('review:file-status.untracked', 'Untracked'),
	};

	return (
		<Icon
			aria-label={label[status]}
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
