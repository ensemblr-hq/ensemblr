import { KeyboardOffIcon } from 'lucide-react';
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

const SHORTCUT_HINT = formatShortcut('composer.toggleAfkMode');

/**
 * Accent tint for the pressed chip, claimed under `aria-pressed:` for the reason
 * the Plan chip's is. Deliberately a different hue from that one: the two chips
 * sit side by side and are mutually exclusive, so a shared tint would read as
 * one control in two positions.
 */
const PRESSED_TINT_CLASSES =
	'aria-pressed:bg-status-away/10 aria-pressed:text-status-away hover:aria-pressed:bg-status-away/15 hover:aria-pressed:text-status-away';

/**
 * Toggle-style AFK chip. While on, the agent is told the user is away: its
 * question tool is refused, the permission confirmations it would raise are
 * approved on the user's behalf, and it is asked to record what it assumed.
 * Mutually exclusive with Plan Mode, which the controller turns off here.
 */
export function AfkModeToggle({
	disabled,
	onChange,
	value,
}: {
	disabled?: boolean;
	onChange: (afkMode: boolean) => void;
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
									'workbench:afk-mode.aria-label-on',
									'AFK mode: on. Click to toggle.',
								)
							: t(
									'workbench:afk-mode.aria-label-off',
									'AFK mode: off. Click to toggle.',
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
					<KeyboardOffIcon className='size-3.5' />
					{/* i18next-instrument-ignore -- borrowed acronym, untranslated in every language like `commit`. */}
					{value ? <span>AFK</span> : null}
				</Button>
			</TooltipTrigger>
			<TooltipContent sideOffset={4}>
				{value
					? t('workbench:afk-mode.tooltip-on', 'Stop working unattended')
					: t('workbench:afk-mode.tooltip-off', 'Work without asking me')}
				<span className='ml-2 text-muted-foreground'>{SHORTCUT_HINT}</span>
			</TooltipContent>
		</Tooltip>
	);
}
