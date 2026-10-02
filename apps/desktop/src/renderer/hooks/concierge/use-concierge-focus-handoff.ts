import { useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';

import {
	type ConciergePresentation,
	conciergeComposerFocusRequestAtom,
} from '@/renderer/state/concierge';

/**
 * The element keyboard focus would return to, or null when it is nowhere useful.
 * @returns The focused element, ignoring the document body.
 */
function focusedElement(): HTMLElement | null {
	const active = document.activeElement;
	return active instanceof HTMLElement && active !== document.body
		? active
		: null;
}

/**
 * Moves keyboard focus into the Concierge when it opens and back out when it
 * closes.
 *
 * Without this the panel is opened by a window-level chord while focus stays
 * wherever it was — a workspace composer, most often — so the two chords the
 * panel binds through React bubbling (⎋ to close, ⌘⇧K to clear) reach nothing,
 * and the only way into the panel is to tab the whole shell. Closing then drops
 * focus onto `<body>`, because the element that had it was inside the subtree
 * that just unmounted.
 *
 * Deliberately no focus trap: ⌘⇧C is a window-level hotkey and has to keep
 * working from anywhere, including from inside the panel.
 * @param presentation - How much of the screen the Concierge is taking.
 */
export function useConciergeFocusHandoff(
	presentation: ConciergePresentation,
): void {
	const requestComposerFocus = useSetAtom(conciergeComposerFocusRequestAtom);
	const restoreTarget = useRef<HTMLElement | null>(null);
	const wasOpen = useRef(false);

	useEffect(() => {
		const isOpen = presentation !== 'closed';
		// Maximizing and restoring are not openings: re-capturing here would record
		// an element inside the panel as the place to return focus to.
		if (isOpen === wasOpen.current) {
			return;
		}
		wasOpen.current = isOpen;
		if (isOpen) {
			restoreTarget.current = focusedElement();
			requestComposerFocus((request) => request + 1);
			return;
		}
		const target = restoreTarget.current;
		restoreTarget.current = null;
		if (target?.isConnected) {
			target.focus();
		}
	}, [presentation, requestComposerFocus]);
}
