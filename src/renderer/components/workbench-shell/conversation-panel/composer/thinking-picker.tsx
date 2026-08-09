import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { cn } from '@/renderer/lib/utils';
import { getThinkingStrength } from '@/renderer/lib/workbench/thinking-strength';
import type { ComposerThinkingOption } from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';
import { getThinkingAxis } from '@/shared/agent-thinking';

import { ThinkingBarIcon } from './thinking-bar-icon';

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
 * Toggle-style thinking-level chip. Clicking cycles to the next level the
 * selected runtime offers — pi runs off → minimal → … → xhigh, Claude Code runs
 * off → low → … → max — and the chip names the dial the way that runtime does.
 * Bar icon mirrors the current strength; tint shifts amber once thinking is on.
 */
export function ThinkingPicker({
	disabled,
	onChange,
	options,
	provider,
	value,
}: {
	disabled?: boolean;
	onChange: (level: string) => void;
	options: readonly ComposerThinkingOption[];
	/** Runtime whose vocabulary the chip labels itself with. */
	provider: AgentProviderId;
	value: string | null;
}) {
	const { t } = useTranslation();
	const handleClick = useCallback(() => {
		const nextId = getNextThinkingId(options, value);
		if (nextId) {
			onChange(nextId);
		}
	}, [onChange, options, value]);

	const isEffortAxis = getThinkingAxis(provider) === 'effort';

	if (options.length === 0) {
		return (
			<span className='inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground text-xs'>
				<ThinkingBarIcon strength={0} />
				<span>
					{isEffortAxis
						? t('workbench:thinking-picker.pending-effort', 'Effort pending')
						: t(
								'workbench:thinking-picker.pending-thinking',
								'Thinking pending',
							)}
				</span>
			</span>
		);
	}

	const selected =
		options.find((option) => option.id === value) ?? options[0] ?? null;
	const strength = getThinkingStrength(provider, selected?.id ?? null);
	const tintClass =
		strength > 0
			? 'bg-status-warning/10 text-status-warning hover:bg-status-warning/15 hover:text-status-warning'
			: undefined;
	const levelLabel =
		selected?.label ?? t('workbench:thinking-picker.off', 'Off');

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					aria-label={
						isEffortAxis
							? t(
									'workbench:thinking-picker.aria-label-effort',
									'Effort level: {{level}}. Click to cycle.',
									{ level: levelLabel },
								)
							: t(
									'workbench:thinking-picker.aria-label-thinking',
									'Thinking level: {{level}}. Click to cycle.',
									{ level: levelLabel },
								)
					}
					className={cn('h-7 rounded-md px-2 font-medium', tintClass)}
					disabled={disabled}
					onClick={handleClick}
					size='sm'
					type='button'
					variant='subtle'
				>
					<ThinkingBarIcon strength={strength} />
					{strength > 0 ? (
						<span>
							{selected?.label ?? t('workbench:thinking-picker.off', 'Off')}
						</span>
					) : null}
				</Button>
			</TooltipTrigger>
			<TooltipContent sideOffset={4}>
				{isEffortAxis
					? t('workbench:thinking-picker.tooltip-effort', 'Adjust effort level')
					: t(
							'workbench:thinking-picker.tooltip-thinking',
							'Adjust thinking level',
						)}
				{/* i18next-instrument-ignore */}
				<span className='ml-2 text-muted-foreground'>⌥T</span>
			</TooltipContent>
		</Tooltip>
	);
}
