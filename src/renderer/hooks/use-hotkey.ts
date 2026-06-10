import { useEffect } from 'react';

interface HotkeyModifiers {
	alt?: boolean;
	ctrl?: boolean;
	meta?: boolean;
	shift?: boolean;
}

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

export function useHotkey(
	key: string,
	modifiers: HotkeyModifiers,
	handler: (event: KeyboardEvent) => void,
	options: HotkeyOptions = {},
): void {
	const { allowInTypeable = true, enabled = true } = options;
	useEffect(() => {
		if (!enabled) {
			return;
		}
		const targetKey = key.toLowerCase();
		const onKey = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() !== targetKey) {
				return;
			}
			if (Boolean(modifiers.alt) !== event.altKey) {
				return;
			}
			if (Boolean(modifiers.ctrl) !== event.ctrlKey) {
				return;
			}
			if (Boolean(modifiers.meta) !== event.metaKey) {
				return;
			}
			if (modifiers.shift !== undefined && modifiers.shift !== event.shiftKey) {
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
	}, [
		key,
		modifiers.alt,
		modifiers.ctrl,
		modifiers.meta,
		modifiers.shift,
		handler,
		allowInTypeable,
		enabled,
	]);
}
