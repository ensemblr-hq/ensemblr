import * as React from 'react';

const MOBILE_BREAKPOINT = 768;
const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * Subscribes to media-query changes for the mobile breakpoint.
 * @param onStoreChange - Callback invoked when the media-query match state flips.
 * @returns A teardown function that removes the listener.
 */
function subscribeToMobileChanges(onStoreChange: () => void) {
	const mediaQueryList = window.matchMedia(MOBILE_MEDIA_QUERY);

	mediaQueryList.addEventListener('change', onStoreChange);
	return () => mediaQueryList.removeEventListener('change', onStoreChange);
}

/** Returns true when the viewport currently matches the mobile breakpoint. */
function getMobileSnapshot() {
	return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

/**
 * React hook returning whether the viewport is below the mobile breakpoint.
 * @returns True when the viewport is mobile-sized.
 */
export function useIsMobile() {
	return React.useSyncExternalStore(
		subscribeToMobileChanges,
		getMobileSnapshot,
		() => false,
	);
}
