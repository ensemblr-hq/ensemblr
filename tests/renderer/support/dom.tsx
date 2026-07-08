// Must be first: registers the DOM before @testing-library/react is evaluated.
import './register-dom';

import { afterEach, expect } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, type RenderResult, render } from '@testing-library/react';
import type { ReactElement } from 'react';

// Import this module FIRST in any component test file. It wires jest-dom matchers
// and unmounts trees after each test. Scoped per-file on purpose: platform-
// sensitive pure-logic tests (keymap, etc.) must keep bun's real navigator, so
// this is never a global bunfig preload.
expect.extend(matchers);

afterEach(() => {
	cleanup();
});

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

/** Installs a stub `window.ensemble` bridge so isEnsembleApiAvailable() is true. */
export function installEnsembleApi(api: Record<string, unknown>): void {
	(window as unknown as { ensemble: unknown }).ensemble = api;
}

/** Removes the stub bridge so a later test starts without one. */
export function clearEnsembleApi(): void {
	(window as unknown as { ensemble?: unknown }).ensemble = undefined;
}
