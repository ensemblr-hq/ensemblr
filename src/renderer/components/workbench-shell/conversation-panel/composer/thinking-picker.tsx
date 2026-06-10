import { useCallback } from 'react';

import { Button } from '@/renderer/components/ui/button';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { cn } from '@/renderer/lib/utils';
import type { ComposerThinkingOption } from '@/renderer/types/workbench';

import { getThinkingStrength, ThinkingBarIcon } from './thinking-bar-icon';

interface ThinkingPickerProps {
	disabled?: boolean;
	onChange: (level: string) => void;
	options: readonly ComposerThinkingOption[];
	value: string | null;
}

/** Computes the next thinking-level id when cycling through the available options. */
export function getNextThinkingId(
	options: readonly ComposerThinkingOption[],
	value: string | null,
): string | null {
	if (options.length === 0) {
		return null;
	}
	const currentIndex = Math.max(
		0,
		options.findIndex((option) => option.id === value),
	);
	const nextIndex = (currentIndex + 1) % options.length;
	return options[nextIndex]?.id ?? null;
}

/**
 * Toggle-style thinking-level chip. Clicking cycles to the next pi thinking
 * level (off → minimal → low → medium → high → xhigh → off). Bar icon mirrors
 * the current strength; tint shifts amber once thinking is enabled.
 */
export function ThinkingPicker({
	disabled,
	onChange,
	options,
	value,
}: ThinkingPickerProps) {
	const handleClick = useCallback(() => {
		const nextId = getNextThinkingId(options, value);
		if (nextId) {
			onChange(nextId);
		}
	}, [onChange, options, value]);

	if (options.length === 0) {
		return (
			<span className='inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground text-xs'>
				<ThinkingBarIcon strength={0} />
				<span>Thinking pending</span>
			</span>
		);
	}

	const selected =
		options.find((option) => option.id === value) ?? options[0] ?? null;
	const strength = getThinkingStrength(selected?.id ?? null);
	const tintClass =
		strength > 0
			? 'bg-status-warning/10 text-status-warning hover:bg-status-warning/15 hover:text-status-warning'
			: undefined;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					aria-label={`Thinking level: ${selected?.label ?? 'Off'}. Click to cycle.`}
					className={cn('h-7 rounded-md px-2 font-medium', tintClass)}
					disabled={disabled}
					onClick={handleClick}
					size='sm'
					type='button'
					variant='subtle'
				>
					<ThinkingBarIcon strength={strength} />
					{strength > 0 ? <span>{selected?.label ?? 'Off'}</span> : null}
				</Button>
			</TooltipTrigger>
			<TooltipContent sideOffset={4}>
				Adjust thinking level
				<span className='ml-2 text-muted-foreground'>⌥T</span>
			</TooltipContent>
		</Tooltip>
	);
}
