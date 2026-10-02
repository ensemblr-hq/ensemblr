import { useEffect, useRef } from 'react';

import type { FocusViewBroadcast } from '@/shared/agent-control';

/**
 * Subscribes once to agent-control focus requests (main → renderer) while always
 * calling the caller's current handler. A ref holds the latest closure so the
 * subscription is registered a single time yet never fires a stale set of
 * navigation setters.
 * @param applyFocus - Handler brought up to date on every render
 */
export function useAgentControlFocus(
	applyFocus: (payload: FocusViewBroadcast) => void,
): void {
	const applyFocusRef = useRef(applyFocus);

	useEffect(() => {
		applyFocusRef.current = applyFocus;
	});

	useEffect(
		() =>
			window.ensemblr?.onAgentControlFocusView((payload) =>
				applyFocusRef.current(payload),
			),
		[],
	);
}
