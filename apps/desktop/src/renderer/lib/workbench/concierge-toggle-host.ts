/**
 * Which part of the workspace screen carries the Concierge toggle: the review
 * rail while it sits inline beside the content, the content column otherwise.
 *
 * One answer for both call sites, because the rail stays mounted at zero width
 * while it is collapsed — two conditions kept in step by hand would leave a
 * second, invisible but tabbable toggle in it, or none anywhere.
 * @param layout - The workbench layout's viewport and rail state.
 * @param layout.isNarrowViewport - Whether the rail is presented as a sheet.
 * @param layout.isRightSidebarCollapsed - Whether the rail is shut.
 * @returns `rail` when the inline rail is on screen, `footer` otherwise.
 */
export function conciergeToggleHost({
	isNarrowViewport,
	isRightSidebarCollapsed,
}: {
	isNarrowViewport: boolean;
	isRightSidebarCollapsed: boolean;
}): 'footer' | 'rail' {
	return isNarrowViewport || isRightSidebarCollapsed ? 'footer' : 'rail';
}
