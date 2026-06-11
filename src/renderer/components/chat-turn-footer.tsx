import { EllipsisIcon, SplitIcon, SquarePlusIcon } from 'lucide-react';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { cn } from '@/renderer/lib/utils';
import { formatTurnDuration } from './chat-turn-timer';
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
}: {
	answerText: string;
	className?: string;
	durationMs: number | null;
	/** Disables the fork menu while a fork is already in flight. */
	forkDisabled?: boolean;
	onForkToNewTab?: () => void;
	onForkToNewWorkspace?: () => void;
}) {
	const hasForkActions = Boolean(onForkToNewTab || onForkToNewWorkspace);
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
							className='rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-secondary/60 hover:text-foreground data-[state=open]:bg-secondary/60 data-[state=open]:text-foreground'
							disabled={forkDisabled}
							type='button'
						>
							<EllipsisIcon aria-hidden='true' className='size-3.5' />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align='start'>
						{onForkToNewTab ? (
							<DropdownMenuItem
								disabled={forkDisabled}
								onSelect={() => onForkToNewTab()}
							>
								<SquarePlusIcon aria-hidden='true' className='size-4' />
								Fork to new tab
							</DropdownMenuItem>
						) : null}
						{onForkToNewWorkspace ? (
							<DropdownMenuItem
								disabled={forkDisabled}
								onSelect={() => onForkToNewWorkspace()}
							>
								<SplitIcon aria-hidden='true' className='size-4' />
								Fork to new workspace
							</DropdownMenuItem>
						) : null}
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
		</div>
	);
}
