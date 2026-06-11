import { useEffect } from 'react';
import { matchesShortcut, type ShortcutId } from '@/shared/keymap';

const TYPEABLE_TAGS = new Set(['INPUT', 'TEXTAREA']);

function isTypeableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	if (target.isContentEditable) {
		return true;
	}
	return TYPEABLE_TAGS.has(target.tagName);
}

interface HotkeyOptions {
	allowInTypeable?: boolean;
	enabled?: boolean;
}

/**
 * Registers a global window-level keydown listener that fires `handler` when
 * the shortcut identified by `id` is pressed. Shortcut definitions live in
 * `src/shared/keymap/shortcuts.ts`.
 */
export function useHotkey(
	id: ShortcutId,
	handler: (event: KeyboardEvent) => void,
	options: HotkeyOptions = {},
): void {
	const { allowInTypeable = true, enabled = true } = options;
	useEffect(() => {
		if (!enabled) {
			return;
		}
		const onKey = (event: KeyboardEvent) => {
			if (!matchesShortcut(id, event)) {
				return;
			}
			if (!allowInTypeable && isTypeableTarget(event.target)) {
				return;
			}
			event.preventDefault();
			handler(event);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [id, handler, allowInTypeable, enabled]);
}
