import { createFileRoute, notFound } from '@tanstack/react-router';
import { type ComponentType, lazy, Suspense } from 'react';

/**
 * Resolves the replay surface through a dynamic import that only the
 * development build can take.
 *
 * `import.meta.env.DEV` is a compile-time constant, so the packaged build folds
 * this to the empty branch and the whole `components/pi-replay` subtree — 2.06 MB
 * of Shiki and fixture data — leaves the module graph rather than shipping as a
 * chunk nothing can navigate to.
 * @returns A module whose default export is the replay view, or a render-nothing
 *   component in any build but development.
 */
const loadPiReplayView = (): Promise<{ default: ComponentType }> =>
	import.meta.env.DEV
		? import('@/renderer/components/pi-replay').then((module) => ({
				default: module.PiReplayView,
			}))
		: Promise.resolve({ default: () => null });

const PiReplayView = lazy(loadPiReplayView);

/** Suspends on the dev-only replay chunk while it loads. */
function PiReplayRoute() {
	return (
		<Suspense fallback={null}>
			<PiReplayView />
		</Suspense>
	);
}

/**
 * Dev-only fixture replay surface at `/debug/pi-replay`. Loads the captured
 * Pi RPC fixtures and renders them through the Pi replay timeline components.
 * 404s outside development builds.
 */
export const Route = createFileRoute('/debug/pi-replay')({
	/** Blocks the debug replay route outside development builds by throwing a 404. */
	beforeLoad: () => {
		if (!import.meta.env.DEV) {
			throw notFound();
		}
	},
	component: PiReplayRoute,
});
