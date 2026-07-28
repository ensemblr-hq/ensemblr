import { MapIcon } from 'lucide-react';
import { useCallback } from 'react';

import { Button } from '@/renderer/components/ui/button';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { cn } from '@/renderer/lib/utils';
import { formatShortcut } from '@/shared/keymap';

const SHORTCUT_HINT = formatShortcut('composer.togglePlanMode');

/**
 * Toggle-style Plan Mode chip. While on, the agent is hard-blocked from editing
 * files and restricted to read-only shell commands until the user approves a
 * plan. Tinted with the accent hue so it never reads as the amber thinking chip.
 */
export function PlanModeToggle({
	disabled,
	onChange,
	value,
}: {
	disabled?: boolean;
	onChange: (planMode: boolean) => void;
	value: boolean;
}) {
	const handleClick = useCallback(() => {
		onChange(!value);
	}, [onChange, value]);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					aria-label={`Plan mode: ${value ? 'on' : 'off'}. Click to toggle.`}
					aria-pressed={value}
					// The `subtle` variant claims `aria-pressed:` for its own grey
					// pressed look, so the accent tint only wins when declared under
					// that same variant.
					className={cn(
						'h-7 rounded-md px-2 font-medium',
						value &&
							'aria-pressed:bg-accent-strong/10 aria-pressed:text-accent-strong hover:aria-pressed:bg-accent-strong/15 hover:aria-pressed:text-accent-strong',
					)}
					disabled={disabled}
					onClick={handleClick}
					size='sm'
					type='button'
					variant='subtle'
				>
					<MapIcon />
					{value ? <span>Plan</span> : null}
				</Button>
			</TooltipTrigger>
			<TooltipContent sideOffset={4}>
				{value ? 'Leave plan mode' : 'Plan before editing'}
				<span className='ml-2 text-muted-foreground'>{SHORTCUT_HINT}</span>
			</TooltipContent>
		</Tooltip>
	);
}
