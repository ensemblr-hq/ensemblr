// Vitest render helper for renderer component tests. The DOM environment is
// provided per file via a `// @vitest-environment happy-dom` docblock; jest-dom
// matchers are registered globally in ./vitest.setup.ts. @testing-library/react
// auto-unmounts trees after each test under Vitest's `globals: true`.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type RenderResult, render } from '@testing-library/react';
import type { ReactElement } from 'react';

/** A QueryClient tuned for tests: no retries, no background refetch churn. */
export function createTestQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: { gcTime: Number.POSITIVE_INFINITY, retry: false },
		},
	});
}

/** Renders `ui` inside a fresh QueryClientProvider; returns the client too for seeding. */
export function renderWithProviders(
	ui: ReactElement,
	options: { client?: QueryClient } = {},
): RenderResult & { client: QueryClient } {
	const client = options.client ?? createTestQueryClient();
	const result = render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
	return { ...result, client };
}

/** Installs a stub `window.ensemblr` bridge so isEnsemblrApiAvailable() is true. */
export function installEnsemblrApi(api: Record<string, unknown>): void {
	(window as unknown as { ensemblr: unknown }).ensemblr = api;
}

/** Removes the stub bridge so a later test starts without one. */
export function clearEnsemblrApi(): void {
	(window as unknown as { ensemblr?: unknown }).ensemblr = undefined;
}
