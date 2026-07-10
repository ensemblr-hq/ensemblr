import { useEffect, useLayoutEffect } from 'react';
import type { LayoutProfileRecord } from '@/renderer/types/instrumentation';
import { enabled, getActiveNavigation, now } from './profiler-store';

/**
 * React effect hook that records mount/unmount events for layout components
 * onto the active navigation profile.
 * @param component - Label of the component being instrumented.
 */
export function useRouteProfilerMount(component: string): void {
	const useProfilerEffect =
		typeof window === 'undefined' ? useEffect : useLayoutEffect;

	useProfilerEffect(() => {
		recordLayoutEvent(component, 'mount');

		return () => recordLayoutEvent(component, 'unmount');
	}, [component]);
}

/** Appends a layout mount/unmount record to the active navigation profile. */
function recordLayoutEvent(
	component: string,
	event: LayoutProfileRecord['event'],
) {
	if (!enabled) {
		return;
	}

	getActiveNavigation()?.layoutRecords.push({
		component,
		event,
		startedAt: now(),
	});
}
