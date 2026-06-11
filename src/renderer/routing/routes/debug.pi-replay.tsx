import { createFileRoute, notFound } from '@tanstack/react-router';
import { PiReplayView } from '@/renderer/components/pi-replay';

/**
 * Dev-only fixture replay surface at `/debug/pi-replay`. Loads the captured
 * Pi RPC fixtures and renders them through the real timeline components.
 * 404s outside development builds.
 */
export const Route = createFileRoute('/debug/pi-replay')({
	beforeLoad: () => {
		if (!import.meta.env.DEV) {
			throw notFound();
		}
	},
	component: PiReplayView,
});
