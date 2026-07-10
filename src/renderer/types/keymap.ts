import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ShortcutId } from '@/shared/keymap';

/**
 * Return value of a `KeymapBinding` handler:
 *   - `true` (or `undefined` / `void`) → matched and consumed; chain stops and
 *     `preventDefault()` is called.
 *   - `false` → not consumed; chain continues to the next binding.
 * Returning `false` lets a handler conditionally pass through (e.g. only
 * confirm autocomplete when the popover is actually open).
 */
type KeymapHandlerResult = boolean | undefined;

/** Handler run for a matched keymap binding; its result decides whether the event is consumed. */
type KeymapHandler<T extends HTMLElement> = (
	event: ReactKeyboardEvent<T>,
) => KeymapHandlerResult;

/** A shortcut id paired with the handler to run when it matches. */
export type KeymapBinding<T extends HTMLElement> = readonly [
	ShortcutId,
	KeymapHandler<T>,
];
