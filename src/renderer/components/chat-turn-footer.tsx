import {
	EllipsisIcon,
	FileDiffIcon,
	HistoryIcon,
	SplitIcon,
	SquarePlusIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import {
	formatTurnClockTime,
	formatTurnDuration,
} from '@/renderer/lib/format-duration';
import { cn } from '@/renderer/lib/utils';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';
import { ChatTurnDiffChips } from './chat-turn-diff-chips';
import { CopyResponseButton } from './copy-response-button';

/**
 * How long the turn took and the wall-clock time it ended, `14s · 3:48 PM`.
 * Either half may be missing, so the separator only appears between two values.
 */
function TurnTiming({
	durationMs,
	endedAtMs,
}: {
	durationMs: number | null;
	endedAtMs: number | null;
}) {
	const parts = [
		durationMs === null ? null : formatTurnDuration(Math.max(0, durationMs)),
		endedAtMs === null ? null : formatTurnClockTime(endedAtMs),
	].filter((part): part is string => part !== null);

	return parts.map((part, index) => (
		<span className='whitespace-nowrap' key={part}>
			{/* i18next-instrument-ignore -- separator glyph */}
			{index > 0 ? <span aria-hidden='true'>· </span> : null}
			{part}
		</span>
	));
}

/**
 * Footer row at the end of a completed assistant turn: the turn's duration and
 * the wall-clock time it ended, an icon-only copy-response button, a `…` menu
 * with fork actions, and a chip per file the turn changed. Fork targets receive
 * a to-the-point handoff summary of the conversation up to this turn, attached
 * as a composer file chip in the destination chat.
 */
export function ChatTurnFooter({
	answerText,
	className,
	durationMs,
	endedAtMs = null,
	forkDisabled = false,
	onForkToNewTab,
	onForkToNewWorkspace,
	onOpenTurnFile,
	onRestoreToCheckpoint,
	onViewTurnDiff,
	turnScope = null,
	workspaceCwd = null,
}: {
	answerText: string;
	className?: string;
	durationMs: number | null;
	/** Wall-clock end of the turn; omitted while the timing is unknown. */
	endedAtMs?: number | null;
	/** Disables the fork menu while a fork is already in flight. */
	forkDisabled?: boolean;
	onForkToNewTab?: () => void;
	onForkToNewWorkspace?: () => void;
	/** Opens one changed file's diff at this turn's scope. */
	onOpenTurnFile?: (filePath: string) => void;
	/** Restores workspace files to this turn's pre-prompt checkpoint. */
	onRestoreToCheckpoint?: () => void;
	/** Opens the diff between this turn's checkpoint and the post-turn state. */
	onViewTurnDiff?: () => void;
	/** What this turn changed; null when no checkpoint was captured for it. */
	turnScope?: Extract<WorkspaceGitDiffScope, { kind: 'turn' }> | null;
	workspaceCwd?: string | null;
}) {
	const { t } = useTranslation();
	const hasForkActions = Boolean(
		onForkToNewTab ||
			onForkToNewWorkspace ||
			onRestoreToCheckpoint ||
			onViewTurnDiff,
	);
	return (
		<div
			className={cn(
				'flex items-start gap-2 text-muted-foreground/80 text-xs',
				className,
			)}
			data-role='turn-footer'
		>
			<div className='flex min-h-6 shrink-0 items-center gap-1'>
				<TurnTiming durationMs={durationMs} endedAtMs={endedAtMs} />
				{answerText.length > 0 ? (
					<CopyResponseButton text={answerText} />
				) : null}
				{hasForkActions ? (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								aria-label={t('common:turn-footer.actions', 'Turn actions')}
								className='rounded-md p-1 text-muted-foreground opacity-70 transition-[color,background-color,opacity] hover:bg-secondary/60 hover:text-foreground hover:opacity-100 data-[state=open]:bg-secondary/60 data-[state=open]:text-foreground data-[state=open]:opacity-100'
								disabled={forkDisabled}
								type='button'
							>
								<EllipsisIcon aria-hidden='true' className='size-3.5' />
							</button>
						</DropdownMenuTrigger>
						{/* Content width defaults to the trigger width — far too narrow
					    for the icon-only trigger, so let it size to the items. */}
						<DropdownMenuContent align='start' className='w-auto'>
							{onForkToNewTab ? (
								<DropdownMenuItem
									className='whitespace-nowrap'
									disabled={forkDisabled}
									onSelect={() => onForkToNewTab()}
								>
									<SquarePlusIcon aria-hidden='true' className='size-4' />
									{t('common:turn-footer.fork-tab', 'Fork to new tab')}
								</DropdownMenuItem>
							) : null}
							{onForkToNewWorkspace ? (
								<DropdownMenuItem
									className='whitespace-nowrap'
									disabled={forkDisabled}
									onSelect={() => onForkToNewWorkspace()}
								>
									<SplitIcon aria-hidden='true' className='size-4' />
									{t(
										'common:turn-footer.fork-workspace',
										'Fork to new workspace',
									)}
								</DropdownMenuItem>
							) : null}
							{onViewTurnDiff ? (
								<DropdownMenuItem
									className='whitespace-nowrap'
									onSelect={() => onViewTurnDiff()}
								>
									<FileDiffIcon aria-hidden='true' className='size-4' />
									{t('common:turn-footer.view-diff', 'View turn diff')}
								</DropdownMenuItem>
							) : null}
							{onRestoreToCheckpoint ? (
								<DropdownMenuItem
									className='whitespace-nowrap'
									onSelect={() => onRestoreToCheckpoint()}
								>
									<HistoryIcon aria-hidden='true' className='size-4' />
									{t(
										'common:turn-footer.restore-checkpoint',
										'Restore to before this turn…',
									)}
								</DropdownMenuItem>
							) : null}
						</DropdownMenuContent>
					</DropdownMenu>
				) : null}
			</div>
			{turnScope && onOpenTurnFile ? (
				<ChatTurnDiffChips
					onOpenFile={onOpenTurnFile}
					onOpenTurnDiff={onViewTurnDiff}
					scope={turnScope}
					workspaceCwd={workspaceCwd}
				/>
			) : null}
		</div>
	);
}
