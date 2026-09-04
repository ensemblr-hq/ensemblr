import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect } from 'react';

import { Toaster } from '@/renderer/components/ui/sonner';
import { WindowTitleBar } from '@/renderer/components/workbench-shell/window-controls/window-title-bar';
import { router } from '@/renderer/routing/router';

import type { DemoRuntime } from './demo-runtime.ts';
import { DemoToolbar } from './demo-toolbar.tsx';

/** Attribute the capture script polls before taking a shot. */
const READY_ATTRIBUTE = 'data-demo-ready';

/** How often the readiness watcher re-checks for settled queries and fonts. */
const READY_POLL_MS = 120;

/**
 * Idle polls a scenario with gestures waits through before it is called ready.
 * A click that swaps a wizard screen starts an enter transition the queries know
 * nothing about, so settling twice is what keeps the shot off a mid-fade frame.
 */
const GESTURE_SETTLE_POLLS = 4;

/**
 * Marks the document ready once nothing is in flight, the bundled faces have
 * loaded, and the scenario's gestures have been applied.
 *
 * A fixed timeout is the wrong instrument here: Shiki tokenizes asynchronously
 * and xterm silently substitutes a fallback for a face that has not finished
 * loading, so a shot taken on a timer catches whichever of the two lost the
 * race.
 * @param queryClient - Client whose in-flight count gates readiness.
 * @param runtime - Runtime holding the scenario whose gestures are applied.
 * @returns A cleanup that stops the watcher and clears the attribute.
 */
function watchReadiness(
	queryClient: QueryClient,
	runtime: DemoRuntime,
): () => void {
	const settlePolls = runtime.current.interactions.length
		? GESTURE_SETTLE_POLLS
		: 0;
	let fontsReady = false;
	let idlePolls = 0;
	void document.fonts.ready.then(() => {
		fontsReady = true;
	});

	const timer = window.setInterval(() => {
		if (!fontsReady || queryClient.isFetching() > 0) {
			idlePolls = 0;
			return;
		}
		if (runtime.applyNextInteraction()) {
			idlePolls = 0;
			return;
		}
		if (idlePolls < settlePolls) {
			idlePolls += 1;
			return;
		}
		window.clearInterval(timer);
		requestAnimationFrame(() => {
			document.documentElement.setAttribute(READY_ATTRIBUTE, 'true');
		});
	}, READY_POLL_MS);

	return () => {
		window.clearInterval(timer);
		document.documentElement.removeAttribute(READY_ATTRIBUTE);
	};
}

/**
 * Mounts the real app — the same providers, title bar and router
 * `src/renderer/main.tsx` mounts — with the demo toolbar over it.
 *
 * Nothing here stands in for an app surface. The window renders the shipped
 * components; only the data behind them is the scenario's.
 */
export function DemoShell({
	drawsOwnControls,
	queryClient,
	runtime,
}: {
	drawsOwnControls: boolean;
	queryClient: QueryClient;
	runtime: DemoRuntime;
}) {
	useEffect(() => watchReadiness(queryClient, runtime), [queryClient, runtime]);
	useEffect(() => runtime.openDeclaredPanels(), [runtime]);

	return (
		<QueryClientProvider client={queryClient}>
			{drawsOwnControls ? <WindowTitleBar /> : null}
			<RouterProvider router={router} />
			<Toaster position='bottom-right' />
			<DemoToolbar queryClient={queryClient} runtime={runtime} />
		</QueryClientProvider>
	);
}
