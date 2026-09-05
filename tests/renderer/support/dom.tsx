// Vitest render helper for renderer component tests. The DOM environment is
// provided per file via a `// @vitest-environment happy-dom` docblock; jest-dom
// matchers are registered globally in ./vitest.setup.ts. @testing-library/react
// auto-unmounts trees after each test under Vitest's `globals: true`.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type RenderResult, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';

/** A QueryClient tuned for tests: no retries, no background refetch churn. */
export function createTestQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: { gcTime: Number.POSITIVE_INFINITY, retry: false },
		},
	});
}

/**
 * Renders `ui` inside a fresh QueryClientProvider; returns the client too for
 * seeding. The returned `rerender` re-applies the same providers, so a test
 * driving a prop change keeps the tree it started with rather than remounting
 * under a bare root.
 */
export function renderWithProviders(
	ui: ReactElement,
	options: { client?: QueryClient } = {},
): RenderResult & { client: QueryClient } {
	const client = options.client ?? createTestQueryClient();
	const withProviders = (node: ReactNode) => (
		<QueryClientProvider client={client}>
			<TooltipProvider>{node}</TooltipProvider>
		</QueryClientProvider>
	);
	const result = render(withProviders(ui));
	return {
		...result,
		client,
		rerender: (next: ReactNode) => {
			result.rerender(withProviders(next));
		},
	};
}

/** Installs a stub `window.ensemblr` bridge so isEnsemblrApiAvailable() is true. */
export function installEnsemblrApi(api: Record<string, unknown>): void {
	(window as unknown as { ensemblr: unknown }).ensemblr = api;
}

/** Removes the stub bridge so a later test starts without one. */
export function clearEnsemblrApi(): void {
	(window as unknown as { ensemblr?: unknown }).ensemblr = undefined;
}

/**
 * Installs a fresh Map-backed `window.localStorage`, so a test that asserts on
 * stored values owns the whole store. Reinstalling resets it.
 *
 * happy-dom ships no `localStorage` of its own; what a test sees without this is
 * whatever the host Node exposes as a process global, which is a real store on
 * Node 24 and nothing at all on some later versions. The shared setup empties
 * that before every test, so this is for tests that want their own object rather
 * than for isolation.
 */
export function installLocalStorage(): void {
	const items = new Map<string, string>();
	const storage: Storage = {
		clear: () => items.clear(),
		getItem: (key) => items.get(key) ?? null,
		key: (index) => Array.from(items.keys())[index] ?? null,
		get length() {
			return items.size;
		},
		removeItem: (key) => {
			items.delete(key);
		},
		setItem: (key, value) => {
			items.set(key, value);
		},
	};
	Object.defineProperty(window, 'localStorage', {
		configurable: true,
		value: storage,
	});
}

/**
 * Replaces the clipboard with a recorder that accepts both the plain and the
 * rich write paths, so a test can assert what a copy control actually offered.
 */
export function stubClipboard(): { html?: string; text: string }[] {
	const written: { html?: string; text: string }[] = [];
	class TestClipboardItem {
		constructor(readonly items: Record<string, Blob>) {}
	}
	Object.defineProperty(globalThis, 'ClipboardItem', {
		configurable: true,
		value: TestClipboardItem,
		writable: true,
	});
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: {
			write: async (entries: TestClipboardItem[]) => {
				for (const entry of entries) {
					written.push({
						html: await entry.items['text/html']?.text(),
						text: (await entry.items['text/plain']?.text()) ?? '',
					});
				}
			},
			writeText: async (text: string) => {
				written.push({ text });
			},
		},
		writable: true,
	});
	return written;
}
