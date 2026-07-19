// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import { createTestQueryClient } from './support/dom';

let configListener: (() => void) | null = null;
const unsubscribe = vi.fn();
const subscribeConfigChanged = vi.fn((listener: () => void) => {
	configListener = listener;
	return unsubscribe;
});

vi.mock('@/renderer/api/ensemblr', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('@/renderer/api/ensemblr')>();
	return {
		...actual,
		subscribeConfigChanged: (listener: () => void) =>
			subscribeConfigChanged(listener),
	};
});

const { useConfigReloadSync } = await import(
	'../../src/renderer/hooks/use-config-reload-sync'
);

beforeEach(() => {
	configListener = null;
	unsubscribe.mockClear();
	subscribeConfigChanged.mockClear();
});

test('a config-changed broadcast invalidates settings-resolution queries', () => {
	const client = createTestQueryClient();
	const invalidate = vi.spyOn(client, 'invalidateQueries');
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);

	renderHook(() => useConfigReloadSync(), { wrapper });

	expect(subscribeConfigChanged).toHaveBeenCalledTimes(1);
	expect(invalidate).not.toHaveBeenCalled();

	configListener?.();

	expect(invalidate).toHaveBeenCalledWith({
		queryKey: ['ensemblr', 'settings-resolution'],
	});
});

test('unmounting removes the config-changed subscription', () => {
	const client = createTestQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);

	const { unmount } = renderHook(() => useConfigReloadSync(), { wrapper });
	unmount();

	expect(unsubscribe).toHaveBeenCalledTimes(1);
});
