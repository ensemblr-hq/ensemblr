import { TooltipContent } from '@/renderer/components/ui/tooltip';

/** Tooltip body pairing a label with an optional keyboard-shortcut chip. */
export function ShortcutTooltipContent({
	label,
	shortcut,
}: {
	label: string;
	shortcut?: string;
}) {
	return (
		<TooltipContent>
			{label}
			{shortcut ? <kbd className='font-sans'>{shortcut}</kbd> : null}
		</TooltipContent>
	);
}
