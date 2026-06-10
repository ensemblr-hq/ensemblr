import { CircleIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/renderer/components/ui/popover';
import { Progress } from '@/renderer/components/ui/progress';
import type { ComposerContextUsage } from '@/renderer/types/workbench';

interface ContextIndicatorProps {
	maxLabel?: string;
	usage: ComposerContextUsage | null;
}

const FALLBACK_MAX = 258_400;

/** Formats token counts into compact model-picker-friendly labels. */
function formatTokens(value: number): string {
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1_000) {
		return `${(value / 1_000).toFixed(1)}k`;
	}
	return String(value);
}

/** Renders the composer context-window gauge and usage popover. */
export function ContextIndicator({ maxLabel, usage }: ContextIndicatorProps) {
	const used = usage?.usedTokens ?? 0;
	const max = usage?.maxTokens ?? FALLBACK_MAX;
	const percent = max > 0 ? Math.min(100, (used / max) * 100) : 0;
	const ringDash = `${percent}, 100`;

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					aria-label='Context usage'
					className='rounded-md text-muted-foreground hover:text-foreground'
					size='icon-sm'
					type='button'
					variant='ghost'
				>
					{usage ? (
						<svg
							aria-hidden='true'
							className='size-4'
							role='img'
							viewBox='0 0 36 36'
						>
							<title>Context usage gauge</title>
							<circle
								cx='18'
								cy='18'
								fill='none'
								r='15.9155'
								stroke='currentColor'
								strokeOpacity='0.2'
								strokeWidth='3'
							/>
							<circle
								cx='18'
								cy='18'
								fill='none'
								pathLength='100'
								r='15.9155'
								stroke='currentColor'
								strokeDasharray={ringDash}
								strokeDashoffset='0'
								strokeLinecap='round'
								strokeWidth='3'
								transform='rotate(-90 18 18)'
							/>
						</svg>
					) : (
						<CircleIcon />
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align='end' className='w-72 gap-3 p-3' sideOffset={10}>
				<div className='flex items-center justify-between'>
					<span className='font-medium text-sm'>Context</span>
					<span className='text-muted-foreground text-xs tabular-nums'>
						{formatTokens(used)}/{maxLabel ?? formatTokens(max)}
					</span>
				</div>
				{usage ? (
					<>
						<Progress className='h-2 bg-muted' value={percent} />
						<div className='flex items-center justify-between text-muted-foreground text-xs'>
							<span>Window used</span>
							<span className='tabular-nums'>{percent.toFixed(1)}%</span>
						</div>
					</>
				) : (
					<p className='text-muted-foreground text-xs'>
						Context window unavailable for this model.
					</p>
				)}
			</PopoverContent>
		</Popover>
	);
}
