import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { DemoRuntime, readDemoRequest } from './demo-runtime.ts';
import { freezeClock } from './frozen-clock.ts';
import { scenarioHref } from './scenario.ts';
import { resolveScenario } from './scenarios/index.ts';

import '@/renderer/styles/index.css';
import './demo.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
	throw new Error('Ensemblr demo root element was not found.');
}

const request = readDemoRequest(window.location.search);
const scenario = resolveScenario(request.scenarioId);

// Ordered deliberately: the clock is frozen and the bridge installed before any
// renderer module is imported. `src/renderer/routing/router.tsx` subscribes to
// the bridge at module load, and the query client seeds itself from the preload
// snapshot at module load, so both would read a bridge that did not exist yet.
freezeClock(scenario.clock);
const runtime = new DemoRuntime(scenario, request.playhead);

const { applyWindowChrome, readWindowChrome } = await import(
	'@/renderer/lib/window-chrome'
);
const { registerIconCollections } = await import(
	'@/renderer/lib/workbench/icon-collections'
);
const { queryClient } = await import('@/renderer/api/query-client');
const { router } = await import('@/renderer/routing/router');
const { DemoShell } = await import('./demo-shell.tsx');

// Answers never go stale and a failed call is never retried, so a scenario
// paints its state once and holds it rather than flickering through an error
// state on a method the bridge deliberately no-ops.
queryClient.setDefaultOptions({
	queries: {
		gcTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
	},
});

registerIconCollections();

const windowChrome = readWindowChrome();
applyWindowChrome(windowChrome);

document.documentElement.classList.add(scenario.theme, 'demo-frozen');
document.documentElement.classList.remove(
	scenario.theme === 'dark' ? 'light' : 'dark',
);

await router.navigate({ href: scenarioHref(scenario) });
runtime.start(queryClient);

createRoot(rootElement).render(
	<StrictMode>
		<DemoShell
			drawsOwnControls={windowChrome.drawsOwnControls}
			queryClient={queryClient}
			runtime={runtime}
		/>
	</StrictMode>,
);

if (import.meta.hot) {
	import.meta.hot.accept('./scenarios/index.ts', (updated) => {
		const next = (
			updated as { resolveScenario: typeof resolveScenario } | undefined
		)?.resolveScenario(runtime.authored.id);
		if (next) {
			runtime.apply(next, queryClient);
			void router.invalidate();
		}
	});
}
