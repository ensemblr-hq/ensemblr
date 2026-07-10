// @vitest-environment happy-dom

import { act, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr';
import { ReviewFilePreviewOpenerProvider } from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { AllFilesList } from '../../src/renderer/components/workbench-shell/review-files/all-files-list';
import { workspaceDirectoryRevealRequestAtom } from '../../src/renderer/state/workspace';
import type { WorkspaceFileSummary } from '../../src/renderer/types/workbench';
import { createTestQueryClient, renderWithProviders } from './support/dom';

vi.mock('@tanstack/react-virtual', () => ({
	useVirtualizer: ({ count }: { count: number }) => ({
		getTotalSize: () => count * 28,
		getVirtualItems: () =>
			Array.from({ length: count }, (_, index) => ({
				index,
				key: index,
				size: 28,
				start: index * 28,
			})),
		scrollToIndex: () => undefined,
	}),
}));

function installLocalStorage(): void {
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

const files: WorkspaceFileSummary[] = [
	{ id: 'src', kind: 'directory', name: 'src', path: 'src' },
	{ id: 'src/main', kind: 'directory', name: 'main', path: 'src/main' },
	{
		id: 'src/main/index.ts',
		kind: 'file',
		name: 'index.ts',
		path: 'src/main/index.ts',
	},
	{
		id: 'src/renderer',
		kind: 'directory',
		name: 'renderer',
		path: 'src/renderer',
	},
	{
		id: 'src/renderer/app.tsx',
		kind: 'file',
		name: 'app.tsx',
		path: 'src/renderer/app.tsx',
	},
];

describe('All files directory reveal', () => {
	beforeEach(() => {
		installLocalStorage();
	});

	test('expands the requested directory path', async () => {
		const client = createTestQueryClient();
		client.setQueryData(ensemblrQueryKeys.workspaceOpenTargets(), {
			targets: [],
		});
		const store = createStore();

		renderWithProviders(
			<Provider store={store}>
				<ReviewFilePreviewOpenerProvider value={vi.fn()}>
					<AllFilesList
						files={files}
						workspaceCwd='/repo'
						workspaceId='workspace-1'
					/>
				</ReviewFilePreviewOpenerProvider>
			</Provider>,
			{ client },
		);

		expect(
			screen.queryByRole('treeitem', { name: 'Collapse src/renderer' }),
		).toBeNull();

		act(() => {
			store.set(workspaceDirectoryRevealRequestAtom, {
				id: 1,
				path: 'src/renderer',
				workspaceId: 'workspace-1',
			});
		});

		await waitFor(() => {
			expect(
				screen.getByRole('treeitem', { name: 'Collapse src/renderer' }),
			).not.toBeNull();
		});
	});
});
