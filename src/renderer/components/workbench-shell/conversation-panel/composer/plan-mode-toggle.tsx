import { MapIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

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
 * Accent tint for the pressed chip. The `subtle` variant claims `aria-pressed:`
 * for its own grey pressed look, so the accent tint only wins when declared
 * under that same variant.
 */
const PRESSED_TINT_CLASSES =
	'aria-pressed:bg-accent-strong/10 aria-pressed:text-accent-strong hover:aria-pressed:bg-accent-strong/15 hover:aria-pressed:text-accent-strong';

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
	const { t } = useTranslation();
	const handleClick = useCallback(() => {
		onChange(!value);
	}, [onChange, value]);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					aria-label={
						value
							? t(
									'workbench:plan-mode.aria-label-on',
									'Plan mode: on. Click to toggle.',
								)
							: t(
									'workbench:plan-mode.aria-label-off',
									'Plan mode: off. Click to toggle.',
								)
					}
					aria-pressed={value}
					className={cn(
						'rounded-md font-medium',
						value && 'px-2',
						value && PRESSED_TINT_CLASSES,
					)}
					disabled={disabled}
					onClick={handleClick}
					size={value ? 'sm' : 'icon-sm'}
					type='button'
					variant='subtle'
				>
					<MapIcon className='size-3.5' />
					{value ? <span>{t('workbench:plan-mode.chip', 'Plan')}</span> : null}
				</Button>
			</TooltipTrigger>
			<TooltipContent sideOffset={4}>
				{value
					? t('workbench:plan-mode.tooltip-on', 'Leave plan mode')
					: t('workbench:plan-mode.tooltip-off', 'Plan before editing')}
				<span className='ml-2 text-muted-foreground'>{SHORTCUT_HINT}</span>
			</TooltipContent>
		</Tooltip>
	);
}
