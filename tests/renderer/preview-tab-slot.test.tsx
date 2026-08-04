// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import { usePreviewTabSlot } from '../../src/renderer/state/workspace/preview-tab-slot';
import type { SessionTabModel } from '../../src/renderer/types/workbench';
import type { ChatTabWire } from '../../src/shared/ipc/contracts/chat-tab';

const { pinChatTab, toastError } = vi.hoisted(() => ({
	pinChatTab: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock('@/renderer/api/ensemblr-queries', async (importOriginal) => ({
	...(await importOriginal<
		typeof import('../../src/renderer/api/ensemblr-queries')
	>()),
	pinChatTab,
}));

vi.mock('sonner', () => ({ toast: { error: toastError } }));

const WORKSPACE_ID = 'ws-1';

function createTab(id: string, isPreview: boolean): SessionTabModel {
	return {
		chatTabId: id,
		filePath: `src/${id}.ts`,
		fullLabel: id,
		id,
		isPreview,
		isSubAgent: false,
		kind: 'file',
		label: id,
		piSessionId: null,
		status: 'idle',
		summary: '',
		updatedLabel: '',
	};
}

function createWire(id: string): ChatTabWire {
	return {
		closedAt: null,
		fullTitle: id,
		id,
		isPreview: false,
		kind: 'file',
		metadata: { filePath: `src/${id}.ts` },
		openedAt: '2026-07-11T00:00:00.000Z',
		piSessionId: null,
		position: 0,
		title: id,
		workspaceId: WORKSPACE_ID,
	};
}

function renderSlot(sessionTabs: SessionTabModel[]) {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	const invalidateChatTabs = vi.fn();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	const { result } = renderHook(
		() =>
			usePreviewTabSlot({
				invalidateChatTabs,
				queryClient,
				sessionTabs,
				workspaceId: WORKSPACE_ID,
			}),
		{ wrapper },
	);
	return { invalidateChatTabs, result };
}

beforeEach(() => {
	pinChatTab.mockReset();
	pinChatTab.mockResolvedValue({ tab: createWire('preview') });
	toastError.mockReset();
});

test('pins the tab holding the preview slot', async () => {
	const { result } = renderSlot([createTab('preview', true)]);

	result.current.pinSessionTab('preview');

	await vi.waitFor(() =>
		expect(pinChatTab).toHaveBeenCalledWith({ chatTabId: 'preview' }),
	);
});

test('does nothing for a tab that is already permanent', () => {
	const { result } = renderSlot([createTab('permanent', false)]);

	result.current.pinSessionTab('permanent');

	expect(pinChatTab).not.toHaveBeenCalled();
});

test('does nothing for a tab that is not open', () => {
	const { result } = renderSlot([createTab('preview', true)]);

	result.current.pinSessionTab('missing');

	expect(pinChatTab).not.toHaveBeenCalled();
});

test('reports a failed pin instead of failing silently', async () => {
	pinChatTab.mockRejectedValue(new Error('database is locked'));
	const { invalidateChatTabs, result } = renderSlot([
		createTab('preview', true),
	]);

	result.current.pinSessionTab('preview');

	await vi.waitFor(() =>
		expect(toastError).toHaveBeenCalledWith('Could not keep tab open', {
			description: 'database is locked',
		}),
	);
	expect(invalidateChatTabs).toHaveBeenCalled();
});
