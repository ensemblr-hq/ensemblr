import {
	EllipsisIcon,
	FileDiffIcon,
	HistoryIcon,
	SplitIcon,
	SquarePlusIcon,
} from 'lucide-react';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { formatTurnDuration } from '@/renderer/lib/format-duration';
import { cn } from '@/renderer/lib/utils';
import { CopyResponseButton } from './copy-response-button';

/**
 * Footer row at the end of a completed assistant turn: total turn duration,
 * an icon-only copy-response button, and a `…` menu with fork actions. Fork
 * targets receive a to-the-point handoff summary of the conversation up to
 * this turn, attached as a composer file chip in the destination chat.
 */
export function ChatTurnFooter({
	answerText,
	className,
	durationMs,
	forkDisabled = false,
	onForkToNewTab,
	onForkToNewWorkspace,
	onRestoreToCheckpoint,
	onViewTurnDiff,
}: {
	answerText: string;
	className?: string;
	durationMs: number | null;
	/** Disables the fork menu while a fork is already in flight. */
	forkDisabled?: boolean;
	onForkToNewTab?: () => void;
	onForkToNewWorkspace?: () => void;
	/** Restores workspace files to this turn's pre-prompt checkpoint. */
	onRestoreToCheckpoint?: () => void;
	/** Opens the diff between this turn's checkpoint and the post-turn state. */
	onViewTurnDiff?: () => void;
}) {
	const hasForkActions = Boolean(
		onForkToNewTab ||
			onForkToNewWorkspace ||
			onRestoreToCheckpoint ||
			onViewTurnDiff,
	);
	return (
		<div
			className={cn(
				'flex items-center gap-1 text-muted-foreground/80 text-xs',
				className,
			)}
			data-role='turn-footer'
		>
			{durationMs !== null ? (
				<span>{formatTurnDuration(Math.max(0, durationMs))}</span>
			) : null}
			{answerText.length > 0 ? <CopyResponseButton text={answerText} /> : null}
			{hasForkActions ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							aria-label='Turn actions'
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
								Fork to new tab
							</DropdownMenuItem>
						) : null}
						{onForkToNewWorkspace ? (
							<DropdownMenuItem
								className='whitespace-nowrap'
								disabled={forkDisabled}
								onSelect={() => onForkToNewWorkspace()}
							>
								<SplitIcon aria-hidden='true' className='size-4' />
								Fork to new workspace
							</DropdownMenuItem>
						) : null}
						{onViewTurnDiff ? (
							<DropdownMenuItem
								className='whitespace-nowrap'
								onSelect={() => onViewTurnDiff()}
							>
								<FileDiffIcon aria-hidden='true' className='size-4' />
								View turn diff
							</DropdownMenuItem>
						) : null}
						{onRestoreToCheckpoint ? (
							<DropdownMenuItem
								className='whitespace-nowrap'
								onSelect={() => onRestoreToCheckpoint()}
							>
								<HistoryIcon aria-hidden='true' className='size-4' />
								Restore to before this turn…
							</DropdownMenuItem>
						) : null}
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
		</div>
	);
}
