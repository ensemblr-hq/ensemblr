import { formatShortcut } from '@/shared/keymap';

const FOCUS_SHORTCUT_HINT = formatShortcut('composer.focus');

/**
 * The "⌘L to focus" hint overlaid on the composer textarea. Shows only while
 * the composer is idle and holds nothing, so it never sits on top of the user's
 * own text or their attachment chips.
 */
export function ComposerFocusHint({
	focused,
	hasChips,
	value,
}: {
	focused: boolean;
	hasChips: boolean;
	value: string;
}) {
	if (focused || value.length > 0 || hasChips) {
		return null;
	}
	return (
		<span
			aria-hidden='true'
			className='pointer-events-none absolute top-0 right-0 text-muted-foreground/60 text-xs'
		>
			{/* Sans, not the kbd UA monospace — monospace renders ⌘/⌥ tiny. */}
			<kbd className='font-sans'>{FOCUS_SHORTCUT_HINT}</kbd>
			<span className='ml-1'>to focus</span>
		</span>
	);
}
