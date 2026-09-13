import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { CheckIcon, MoreVerticalIcon, Undo2Icon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	workspaceCheckpointsQuery,
	workspaceCommitsQuery,
} from '@/renderer/api/ensemblr';
import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { cn } from '@/renderer/lib/utils';
import { latestTurnCheckpointScope } from '@/renderer/lib/workbench';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { ChangesSource } from '@/renderer/types/workbench-shell';
import { formatChord } from '@/shared/keymap';

/**
 * Dismissable pill showing the active non-default change source. Clicking it
 * (the ✕) clears the filter back to "All changes".
 */
export function ChangesSourceBadge({
	latestTurnLabel,
	onClear,
	source,
}: {
	/** Prompt summary of the newest turn, shown as the badge's tooltip. */
	latestTurnLabel?: string | null;
	onClear: () => void;
	source: ChangesSource;
}) {
	const { t } = useTranslation();

	if (source.kind === 'all') {
		return null;
	}
	const label = badgeLabel(t, source);

	return (
		<Button
			className='h-7 max-w-40 gap-1 px-2'
			onClick={onClear}
			size='xs'
			title={badgeTitle(t, source, latestTurnLabel ?? null)}
			variant='outline'
		>
			<XIcon data-icon='inline-start' />
			<span className={cn('truncate', source.kind === 'commit' && 'font-mono')}>
				{label}
			</span>
		</Button>
	);
}

/** A source the badge can render — "All changes" is the badge's absence. */
type BadgedChangesSource = Exclude<ChangesSource, { kind: 'all' }>;

/**
 * Short label for the active source's badge.
 * @param t - Translator bound to the active language
 * @param source - The non-default source being shown
 * @returns The badge's visible text
 */
function badgeLabel(t: TFunction, source: BadgedChangesSource): string {
	if (source.kind === 'uncommitted') {
		return t('git:changes-source.uncommitted-badge', 'Uncommitted');
	}
	if (source.kind === 'latest-turn') {
		return t('git:changes-source.latest-turn-badge', 'Latest turn');
	}
	return source.shortHash;
}

/**
 * Hover text for the active source's badge, naming what it is scoped to.
 * @param t - Translator bound to the active language
 * @param source - The non-default source being shown
 * @param latestTurnLabel - Prompt summary of the newest turn, when known
 * @returns The badge's title attribute
 */
function badgeTitle(
	t: TFunction,
	source: BadgedChangesSource,
	latestTurnLabel: string | null,
): string {
	if (source.kind === 'commit') {
		return source.subject;
	}
	if (source.kind === 'latest-turn') {
		return (
			latestTurnLabel ??
			t('git:changes-source.latest-turn', 'Changes from the latest turn')
		);
	}
	return t('git:changes-source.uncommitted', 'Uncommitted changes');
}

/** Dropdown for picking the Changes tab's source: all, uncommitted, a turn, or a commit. */
export function ChangesOverflowMenu({
	onDiscardAll,
	onSelectSource,
	source,
	workspace,
}: {
	/** Opens the confirm dialog to discard every uncommitted change, when any exist. */
	onDiscardAll: () => void;
	onSelectSource: (source: ChangesSource) => void;
	source: ChangesSource;
	workspace: WorkspaceShellModel;
}) {
	const { t } = useTranslation();
	// Nothing here reads git until the menu actually opens — there is no reason
	// to query every workspace the user merely glances at.
	const [open, setOpen] = useState(false);
	// Scope the list to this branch's own commits so base-branch history (and the
	// root/initial commit) never pollutes the menu.
	const baseRef = workspace.landingSummary?.branchSource.baseBranch ?? null;
	const { data: checkpointsData } = useQuery({
		...workspaceCheckpointsQuery(workspace.id),
		enabled: open,
	});
	const latestTurnLabel =
		latestTurnCheckpointScope(checkpointsData?.checkpoints ?? [])?.label ??
		null;
	const uncommittedCount = workspace.changeSummary.files;

	return (
		<DropdownMenu onOpenChange={setOpen} open={open}>
			<DropdownMenuTrigger asChild>
				<Button size='icon-sm' variant='ghost'>
					<MoreVerticalIcon />
					<span className='sr-only'>
						{t('git:changes-source.menu-label', 'Open changes menu')}
					</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-80 p-0'>
				<div className='p-1'>
					<DropdownMenuItem
						className='h-9 px-2 text-sm'
						onSelect={() => onSelectSource({ kind: 'all' })}
					>
						<span className='min-w-0 flex-1 truncate'>
							{t('git:changes-source.all', 'All changes')}
						</span>
						{source.kind === 'all' ? (
							<CheckIcon aria-hidden='true' className='size-4' />
						) : null}
					</DropdownMenuItem>
					<DropdownMenuItem
						className='items-start px-2 py-2'
						onSelect={() => onSelectSource({ kind: 'latest-turn' })}
					>
						<div className='min-w-0 flex-1'>
							<div className='truncate font-medium text-sm'>
								{t(
									'git:changes-source.latest-turn',
									'Changes from the latest turn',
								)}
							</div>
							<div className='truncate text-muted-foreground text-xs'>
								{latestTurnLabel ??
									t(
										'git:changes-source.latest-turn-empty',
										'No agent turn has run here yet',
									)}
							</div>
						</div>
						{source.kind === 'latest-turn' ? (
							<CheckIcon aria-hidden='true' className='size-4' />
						) : null}
					</DropdownMenuItem>
					<DropdownMenuItem
						className='items-start px-2 py-2'
						onSelect={() => onSelectSource({ kind: 'uncommitted' })}
					>
						<div className='min-w-0 flex-1'>
							<div className='truncate font-medium text-sm'>
								{t('git:changes-source.uncommitted', 'Uncommitted changes')}
							</div>
							<div className='text-muted-foreground text-xs'>
								{uncommittedCount > 0
									? t('git:changes-source.changed-file-count', {
											count: uncommittedCount,
											defaultValue_one: '{{count}} file changed',
											defaultValue_other: '{{count}} files changed',
										})
									: t(
											'git:changes-source.uncommitted-empty',
											'No uncommitted changes',
										)}
							</div>
						</div>
						{source.kind === 'uncommitted' ? (
							<CheckIcon aria-hidden='true' className='size-4' />
						) : (
							<DropdownMenuShortcut>
								{formatChord(['alt', 'mod'], 'U')}
							</DropdownMenuShortcut>
						)}
					</DropdownMenuItem>
				</div>
				<DropdownMenuSeparator className='my-0' />
				<CommitSourceList
					baseRef={baseRef}
					enabled={open}
					onSelectSource={onSelectSource}
					source={source}
					workspaceCwd={workspace.pathLabel}
				/>
				{uncommittedCount > 0 ? (
					<>
						<DropdownMenuSeparator className='my-0' />
						<div className='p-1'>
							<DropdownMenuItem
								className='h-9 gap-2 px-2 text-sm text-status-danger focus:text-status-danger'
								onSelect={onDiscardAll}
							>
								<Undo2Icon aria-hidden='true' />
								<span className='min-w-0 flex-1 truncate'>
									{t(
										'git:changes-source.discard-all',
										'Discard all uncommitted changes',
									)}
								</span>
							</DropdownMenuItem>
						</div>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * The branch's own commits as selectable sources, with the failed, loading, and
 * empty states the `git log` read can land in. Split out of the menu because
 * those four states are the bulk of its branching and none of them concern the
 * rows above it.
 */
function CommitSourceList({
	baseRef,
	enabled,
	onSelectSource,
	source,
	workspaceCwd,
}: {
	baseRef: string | null;
	/** False until the menu opens, so the `git log` is never read speculatively. */
	enabled: boolean;
	onSelectSource: (source: ChangesSource) => void;
	source: ChangesSource;
	workspaceCwd: string | null;
}) {
	const { t } = useTranslation();
	const { data, isError, isPending } = useQuery({
		...workspaceCommitsQuery(workspaceCwd, baseRef),
		enabled: enabled && Boolean(workspaceCwd),
	});

	if (isError || data?.error) {
		return (
			<CommitListNotice
				text={t('git:changes-source.commits-failed', 'Could not load commits.')}
			/>
		);
	}
	if (isPending) {
		return (
			<CommitListNotice
				text={t('git:changes-source.commits-loading', 'Loading commits…')}
			/>
		);
	}
	if (data.commits.length === 0) {
		return (
			<CommitListNotice
				text={t('git:changes-source.commits-empty', 'No commits yet.')}
			/>
		);
	}

	return (
		<div className='sleek-scrollbar max-h-72 overflow-y-auto p-1'>
			{data.commits.map((commit) => (
				<DropdownMenuItem
					className='items-start px-2 py-2'
					key={commit.hash}
					onSelect={() =>
						onSelectSource({
							hash: commit.hash,
							kind: 'commit',
							shortHash: commit.shortHash,
							subject: commit.subject,
						})
					}
				>
					<div className='min-w-0 flex-1'>
						<div className='truncate font-medium text-sm'>{commit.subject}</div>
						<div className='truncate text-muted-foreground text-xs'>
							{commit.shortHash} • {commit.author} • {commit.relativeTime}
						</div>
					</div>
					{source.kind === 'commit' && source.hash === commit.hash ? (
						<CheckIcon aria-hidden='true' className='mt-0.5 size-4' />
					) : null}
				</DropdownMenuItem>
			))}
		</div>
	);
}

/** One muted line standing in for the commit list while it cannot be shown. */
function CommitListNotice({ text }: { text: string }) {
	return <div className='px-2 py-2 text-muted-foreground text-xs'>{text}</div>;
}
