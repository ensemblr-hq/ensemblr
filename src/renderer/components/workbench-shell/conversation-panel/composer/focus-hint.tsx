import { Trans } from 'react-i18next';

import { formatShortcut, type ShortcutId } from '@/shared/keymap';

/**
 * The "⌘L to focus" hint overlaid on the composer textarea. Shows only while
 * the composer is idle and holds nothing, so it never sits on top of the user's
 * own text or their attachment chips.
 *
 * The chord is a prop rather than a constant because the Concierge composer is
 * focused by a chord of its own: a hint naming the workspace composer's would
 * teach a shortcut that does not reach the surface it is drawn on.
 */
export function ComposerFocusHint({
	focused,
	hasChips,
	shortcutId = 'composer.focus',
	value,
}: {
	focused: boolean;
	hasChips: boolean;
	shortcutId?: ShortcutId;
	value: string;
}) {
	if (focused || value.length > 0 || hasChips) {
		return null;
	}
	return (
		<span
			aria-hidden='true'
			className='pointer-events-none absolute top-0 right-0 text-muted-foreground/60 text-xs leading-relaxed'
		>
			<Trans
				components={{
					// Sans, not the kbd UA monospace — monospace renders ⌘/⌥ tiny.
					key: <kbd className='font-sans' />,
					label: <span className='ml-1' />,
				}}
				defaults='<key>{{shortcut}}</key><label>to focus</label>'
				i18nKey='workbench:composer.focus-hint'
				values={{ shortcut: formatShortcut(shortcutId) }}
			/>
		</span>
	);
}
