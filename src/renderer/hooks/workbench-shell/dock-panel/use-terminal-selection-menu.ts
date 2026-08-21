import { type RefObject, useCallback, useRef, useState } from 'react';

import type { TerminalRendererAdapter } from '@/renderer/types/terminal';

/**
 * Wires a terminal surface's right-click menu to the selection under it: what
 * the menu may attach, when that is read, and where keyboard focus goes once the
 * menu closes.
 *
 * The selection is read on open rather than from a handler of our own: xterm
 * listens for `contextmenu` on its inner element and, with
 * `rightClickSelectsWord` (on by default on macOS), a right-click outside the
 * selection replaces it with the word under the cursor. Radix opens from the
 * trigger, after that — anything earlier captures the selection the click just
 * discarded.
 *
 * Focus is placed explicitly because Radix restores it to the trigger, which is
 * the wrapper around the terminal rather than the terminal inside it, and which
 * carries no `tabIndex` — so focus falls through to `<body>` and the next Tab
 * restarts from the top of the document. An interactive pane takes focus back
 * itself; a read-only pane must not steal it from the composer, so it goes back
 * wherever it was before the menu opened.
 * @param adapterRef - The live terminal adapter, absent until the surface mounts
 * @param readOnly - Whether this pane refuses keyboard input (Setup/Run output)
 * @returns The captured selection plus the menu's open and close handlers
 */
export function useTerminalSelectionMenu({
	adapterRef,
	readOnly,
}: {
	adapterRef: RefObject<TerminalRendererAdapter | null>;
	readOnly: boolean;
}): {
	onCloseAutoFocus: (event: Event) => void;
	onOpenChange: (open: boolean) => void;
	selection: string;
} {
	const [selection, setSelection] = useState('');
	const focusBeforeMenuRef = useRef<HTMLElement | null>(null);

	const onOpenChange = useCallback(
		(open: boolean) => {
			if (!open) {
				return;
			}
			focusBeforeMenuRef.current =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: null;
			setSelection(adapterRef.current?.getSelection() ?? '');
		},
		[adapterRef],
	);

	const onCloseAutoFocus = useCallback(
		(event: Event) => {
			event.preventDefault();
			if (readOnly) {
				focusBeforeMenuRef.current?.focus();
				return;
			}
			adapterRef.current?.focus();
		},
		[adapterRef, readOnly],
	);

	return { onCloseAutoFocus, onOpenChange, selection };
}
