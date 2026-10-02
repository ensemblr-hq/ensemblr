/**
 * Decides whether a tab's click should activate it, guarding against the click
 * Motion's `Reorder.Item` synthesizes on the tab button after a drag-reorder.
 *
 * Keyboard activation (Enter/Space) reports `clickDetail === 0` and must always
 * select. A pointer-driven click that follows a drag (`didDrag`) is the
 * synthesized reorder click and must be ignored so reordering never re-selects.
 * @param didDrag - Whether a drag started on this tab since the last click
 * @param clickDetail - The click event's `detail` (0 for keyboard activation)
 * @returns True when the click should select the tab
 */
export function shouldSelectOnTabClick(
	didDrag: boolean,
	clickDetail: number,
): boolean {
	const isKeyboardActivation = clickDetail === 0;
	return isKeyboardActivation || !didDrag;
}
