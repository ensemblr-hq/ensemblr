/** Safely extracts a string route param from a router match. */
export function getStringRouteParam(
	params: Record<string, unknown> | undefined,
	key: string,
) {
	const value = params?.[key];

	return typeof value === 'string' ? value : undefined;
}

/** Extracts the `workbenchView` value from a route's `staticData` payload. */
export function getWorkbenchStaticView(staticData: unknown) {
	if (typeof staticData !== 'object' || staticData === null) {
		return undefined;
	}

	return 'workbenchView' in staticData ? staticData.workbenchView : undefined;
}
