import { type KeyboardEvent as ReactKeyboardEvent, useCallback } from 'react';
import { matchesShortcut, type ShortcutId } from '@/shared/keymap';

/**
 * Return value of a `KeymapBinding` handler:
 *   - `true` (or `undefined` / `void`) → matched and consumed; chain stops and
 *     `preventDefault()` is called.
 *   - `false` → not consumed; chain continues to the next binding.
 * Returning `false` lets a handler conditionally pass through (e.g. only
 * confirm autocomplete when the popover is actually open).
 */
export type KeymapHandlerResult = boolean | undefined;

/** Handler run for a matched keymap binding; its result decides whether the event is consumed. */
export type KeymapHandler<T extends HTMLElement> = (
	event: ReactKeyboardEvent<T>,
) => KeymapHandlerResult;

/** A shortcut id paired with the handler to run when it matches. */
export type KeymapBinding<T extends HTMLElement> = readonly [
	ShortcutId,
	KeymapHandler<T>,
];

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
