import { type KeyboardEvent as ReactKeyboardEvent, useCallback } from 'react';
import type { KeymapBinding } from '@/renderer/types/keymap';
import { matchesShortcut } from '@/shared/keymap';

/**
 * Builds a React `onKeyDown` handler from an ordered list of shortcut bindings.
 * First matching shortcut whose handler does not return `false` wins; the
 * event is then `preventDefault()`-ed and propagation stops.
 *
 * Bindings are checked in order, so put higher-precedence shortcuts first
 * (e.g. autocomplete confirm before composer submit).
 */
export function useKeymapHandler<T extends HTMLElement>(
	bindings: readonly KeymapBinding<T>[],
): (event: ReactKeyboardEvent<T>) => void {
	return useCallback(
		(event: ReactKeyboardEvent<T>) => {
			for (const [id, handler] of bindings) {
				if (!matchesShortcut(id, event)) {
					continue;
				}
				const result = handler(event);
				if (result === false) {
					continue;
				}
				event.preventDefault();
				return;
			}
		},
		[bindings],
	);
}
